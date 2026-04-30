# Plan #23 — @Mentions + Watchers + In-App Inbox

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Notify users of activity they care about. Users get notified when @mentioned in a comment, when watched cards change, or when assigned a card. A bell icon in the top nav surfaces unread notifications, and `/inbox` lists everything.

**Out of scope (this plan):** Email delivery (defer — needs Resend/SendGrid setup; lands in plan #24 alongside push). Email digest cron (same).

**Architecture:**
- New tables: `notifications`, `card_watchers`.
- Auto-watch trigger: when a user comments on a card, becomes assignee, or is mentioned, they're added to watchers (idempotent).
- `notifications` written by SQL triggers on `comments`, `card_members`, and via a server-side parser for `@mentions` (regex on comment body at insert time).
- New nav bell: client component reads count + 8 most-recent via realtime subscription on the user's notification rows.
- `/inbox` page: paginated list, filter (unread / mentions / comments / due), bulk mark-as-read.

**Definition of done:**
- Adding `@username` in a comment → that user gets a notification of kind `comment.mention`.
- Adding a card_member → that user gets a notification of kind `card.assigned`.
- Watching a card → user gets notifications when card is moved/archived/commented.
- Bell shows unread count; click → dropdown of 8 most recent + "View all".
- `/inbox` page lists notifications; mark-as-read individual + bulk; filter chips.
- 6 new integration tests cover: mention parsing, auto-watch on comment, auto-watch on assign, watcher notify on archive, RLS isolation, mark-as-read.
- 68 + 6 tests still pass.

---

## Files

**Migrations:**
- `0023_notifications.sql` — `notifications` table + RLS (only recipient reads).
- `0024_watchers.sql` — `card_watchers` table + RLS.
- `0025_notify_triggers.sql` — auto-watch + notify triggers.
- `0026_user_notification_prefs.sql` — `user_notification_prefs` (kind, channel, enabled). For now only `in_app` channel is meaningful; email/push toggles are placeholders.

**Schema:** append `notifications`, `cardWatchers`, `userNotificationPrefs` to `lib/db/schema.ts`.

**Validation:** `lib/validation.ts` — `MarkNotificationReadInput`, `MarkAllReadInput`, `WatchCardInput`, `UnwatchCardInput`.

**Server actions:**
- `actions/notifications.ts` — `markNotificationRead`, `markAllRead`.
- `actions/watchers.ts` — `watchCard`, `unwatchCard`.
- Extend `actions/comments.ts` `createCommentImpl` to also parse `@username` and call a SECURITY DEFINER fn `add_mention_notifications(comment_id, body)` that resolves usernames → user IDs and inserts notifications.

**Read helpers:**
- `lib/queries/notifications.ts` — `listNotifications(token, opts)`, `unreadCount(token)`, `recentForBell(token, limit)`.

**Realtime:**
- `hooks/use-inbox-realtime.ts` — subscribes to user's `notifications` rows.

**Components:**
- `components/nav/notification-bell.tsx` — client; bell icon + count badge + dropdown.
- `app/(app)/inbox/page.tsx` — server component listing notifications.
- `components/inbox/inbox-list.tsx` — client; filter chips + mark-read.
- `components/board/card/watch-toggle.tsx` — eye icon in card modal toolbar to start/stop watching.

**Modify:**
- `components/board/card-modal.tsx` — render `<WatchToggle cardId={...} />`.
- `components/nav/top-nav.tsx` — render `<NotificationBell />`.

**Tests:** `tests/integration/notifications.test.ts`.

---

## Task 1: Migrations + schema

`supabase/migrations/0023_notifications.sql`:

```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'comment.mention', 'comment.create',
    'card.assigned', 'card.unassigned',
    'card.archived', 'card.unarchived',
    'card.moved', 'card.due',
    'card.label.added',
    'board.member.added'
  )),
  payload jsonb not null default '{}'::jsonb,
  related_card_id uuid references public.cards(id) on delete set null,
  related_board_id uuid references public.boards(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient_user_id, created_at desc);
create index on public.notifications (recipient_user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_self_select on public.notifications for select
  using (recipient_user_id = auth.uid());

create policy notifications_self_update on public.notifications for update
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

create policy notifications_self_delete on public.notifications for delete
  using (recipient_user_id = auth.uid());

-- INSERT: only via SECURITY DEFINER triggers.

alter publication supabase_realtime add table public.notifications;
```

`supabase/migrations/0024_watchers.sql`:

```sql
create table public.card_watchers (
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  auto boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create index on public.card_watchers (board_id);

create or replace function public.set_card_watcher_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_watchers: card not found'; end if;
  new.board_id := bid;
  return new;
end$$;

create trigger card_watchers_set_board_id
  before insert or update of card_id on public.card_watchers
  for each row execute function public.set_card_watcher_board_id();

alter table public.card_watchers enable row level security;

create policy card_watchers_select on public.card_watchers for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = card_watchers.board_id and bm.user_id = auth.uid())
  );

create policy card_watchers_self_write on public.card_watchers for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cards c
      join public.board_members bm on bm.board_id = c.board_id
      where c.id = card_watchers.card_id and bm.user_id = auth.uid()
    )
  );

create policy card_watchers_self_delete on public.card_watchers for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.card_watchers;
```

`supabase/migrations/0025_notify_triggers.sql`:

```sql
-- Helper to insert a notification (SECURITY DEFINER bypasses the no-INSERT
-- policy on notifications).
create or replace function public.emit_notification(
  p_recipient uuid, p_kind text, p_card uuid, p_board uuid,
  p_actor uuid, p_payload jsonb
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if; -- skip self-notify
  insert into public.notifications (
    recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload
  ) values (p_recipient, p_kind, p_card, p_board, p_actor, coalesce(p_payload, '{}'::jsonb));
end$$;

-- 1) Comments: notify all watchers + auto-watch the author + parse @mentions
create or replace function public.parse_mentions(p_body text)
returns table(handle text) language sql immutable
as $$
  select distinct lower(substring(m from 2))
  from regexp_matches(coalesce(p_body, ''), '(?<!\w)@([A-Za-z0-9_.\-]{2,40})', 'g') as t(m);
$$;

create or replace function public.handle_comment_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  w record;
  m record;
  uid uuid;
begin
  -- auto-watch the author
  insert into public.card_watchers (card_id, user_id, board_id, auto)
  values (new.card_id, new.author_id, new.board_id, true)
  on conflict do nothing;

  -- mentions → resolve handle (display_name lower) → notification + auto-watch
  for m in select * from public.parse_mentions(new.body) loop
    select id into uid from public.profiles where lower(display_name) = m.handle limit 1;
    if uid is not null then
      perform public.emit_notification(
        uid, 'comment.mention', new.card_id, new.board_id, new.author_id,
        jsonb_build_object('comment_id', new.id, 'preview', left(new.body, 200))
      );
      insert into public.card_watchers (card_id, user_id, board_id, auto)
      values (new.card_id, uid, new.board_id, true)
      on conflict do nothing;
    end if;
  end loop;

  -- watchers → notification (excluding mentioned users + author covered by emit_notification)
  for w in
    select cw.user_id from public.card_watchers cw where cw.card_id = new.card_id
  loop
    perform public.emit_notification(
      w.user_id, 'comment.create', new.card_id, new.board_id, new.author_id,
      jsonb_build_object('comment_id', new.id, 'preview', left(new.body, 200))
    );
  end loop;

  return new;
end$$;

create trigger notif_comments_aiu after insert on public.comments
  for each row execute function public.handle_comment_insert();

-- 2) card_members: assignee gets notified + auto-watch
create or replace function public.handle_card_member_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    new.user_id, 'card.assigned', new.card_id, new.board_id, auth.uid(),
    jsonb_build_object('card_id', new.card_id)
  );
  insert into public.card_watchers (card_id, user_id, board_id, auto)
  values (new.card_id, new.user_id, new.board_id, true)
  on conflict do nothing;
  return new;
end$$;

create trigger notif_card_members_aiu after insert on public.card_members
  for each row execute function public.handle_card_member_insert();

create or replace function public.handle_card_member_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    old.user_id, 'card.unassigned', old.card_id, old.board_id, auth.uid(),
    jsonb_build_object()
  );
  return old;
end$$;

create trigger notif_card_members_ad after delete on public.card_members
  for each row execute function public.handle_card_member_delete();

-- 3) cards: archive/unarchive/move/due → notify watchers
create or replace function public.handle_card_update_for_watchers()
returns trigger language plpgsql security definer set search_path = public
as $$
declare w record;
begin
  if old.archived is distinct from new.archived then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id,
        case when new.archived then 'card.archived' else 'card.unarchived' end,
        new.id, new.board_id, auth.uid(),
        jsonb_build_object('title', new.title)
      );
    end loop;
  end if;
  if (old.list_id is distinct from new.list_id) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.moved', new.id, new.board_id, auth.uid(),
        jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id)
      );
    end loop;
  end if;
  if (old.due_date is distinct from new.due_date) or (old.due_complete is distinct from new.due_complete) then
    for w in select user_id from public.card_watchers where card_id = new.id loop
      perform public.emit_notification(
        w.user_id, 'card.due', new.id, new.board_id, auth.uid(),
        jsonb_build_object('due_date', new.due_date, 'due_complete', new.due_complete)
      );
    end loop;
  end if;
  return new;
end$$;

create trigger notif_cards_aud after update on public.cards
  for each row execute function public.handle_card_update_for_watchers();

-- 4) board_members: new member gets a welcome notification
create or replace function public.handle_board_member_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.emit_notification(
    new.user_id, 'board.member.added', null, new.board_id, auth.uid(),
    jsonb_build_object('role', new.role)
  );
  return new;
end$$;

create trigger notif_board_members_aiu after insert on public.board_members
  for each row execute function public.handle_board_member_insert();
```

`supabase/migrations/0026_user_notification_prefs.sql`:

```sql
create table public.user_notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('in_app', 'email', 'push')),
  enabled boolean not null default true,
  primary key (user_id, kind, channel)
);

alter table public.user_notification_prefs enable row level security;
create policy unp_self on public.user_notification_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Drizzle:
```ts
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientUserId: uuid("recipient_user_id").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  relatedCardId: uuid("related_card_id"),
  relatedBoardId: uuid("related_board_id"),
  actorUserId: uuid("actor_user_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardWatchers = pgTable("card_watchers", {
  cardId: uuid("card_id").notNull(),
  userId: uuid("user_id").notNull(),
  boardId: uuid("board_id").notNull(),
  auto: boolean("auto").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }));

export const userNotificationPrefs = pgTable("user_notification_prefs", {
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  channel: text("channel").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.kind, t.channel] }) }));
```

Apply: `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`. 68 tests still pass.

Commit: `feat(db): notifications + card_watchers + notify triggers`

---

## Task 2: Validation + actions

`lib/validation.ts`:
```ts
export const MarkNotificationReadInput = z.object({ id: Uuid, read: z.boolean() });
export const MarkAllReadInput = z.object({});
export const WatchCardInput = z.object({ cardId: Uuid });
export const UnwatchCardInput = z.object({ cardId: Uuid });
```

`actions/notifications.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq, and, isNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { MarkNotificationReadInput } from "@/lib/validation";

export async function markNotificationReadImpl(token: string, input: { id: string; read: boolean }) {
  const p = MarkNotificationReadInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(notifications)
      .set({ readAt: p.read ? new Date() : null })
      .where(eq(notifications.id, p.id)).returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function markAllReadImpl(token: string) {
  return dbAsUser(token, async (tx) => {
    await tx.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
  });
}

export async function markNotificationRead(input: { id: string; read: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await markNotificationReadImpl(t, input);
  revalidatePath("/inbox");
  return r;
}

export async function markAllRead() {
  await requireUser();
  const t = (await getSessionToken())!;
  await markAllReadImpl(t);
  revalidatePath("/inbox");
}
```

`actions/watchers.ts`:
```ts
"use server";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardWatchers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { WatchCardInput, UnwatchCardInput } from "@/lib/validation";

function decodeSub(jwt: string) {
  const [, p] = jwt.split(".");
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).sub as string;
}

export async function watchCardImpl(token: string, input: { cardId: string }) {
  const p = WatchCardInput.parse(input);
  const uid = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await tx.insert(cardWatchers)
      .values({
        cardId: p.cardId, userId: uid,
        boardId: "00000000-0000-0000-0000-000000000000",
        auto: false,
      })
      .onConflictDoNothing();
  });
}

export async function unwatchCardImpl(token: string, input: { cardId: string }) {
  const p = UnwatchCardInput.parse(input);
  const uid = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await tx.delete(cardWatchers)
      .where(and(eq(cardWatchers.cardId, p.cardId), eq(cardWatchers.userId, uid)));
  });
}

export async function watchCard(input: { cardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await watchCardImpl(t, input);
}
export async function unwatchCard(input: { cardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await unwatchCardImpl(t, input);
}
```

Commit: `feat(notif): markRead + watch/unwatch actions`

---

## Task 3: Read helpers

`lib/queries/notifications.ts`:

```ts
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { notifications, cards, boards, profiles, cardWatchers } from "@/lib/db/schema";

export type NotificationRow = {
  id: string;
  kind: string;
  payload: unknown;
  relatedCardId: string | null;
  relatedBoardId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
  cardTitle: string | null;
  boardTitle: string | null;
};

export async function listNotifications(
  token: string,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean; kinds?: string[] } = {},
): Promise<NotificationRow[]> {
  const { limit = 50, offset = 0, unreadOnly, kinds } = opts;
  return dbAsUser(token, async (tx) => {
    const where = and(
      unreadOnly ? isNull(notifications.readAt) : sql`true`,
      kinds && kinds.length ? sql`${notifications.kind} = any(${kinds})` : sql`true`,
    );
    const rows = await tx.select({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      relatedCardId: notifications.relatedCardId,
      relatedBoardId: notifications.relatedBoardId,
      actorUserId: notifications.actorUserId,
      actorName: profiles.displayName,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      cardTitle: cards.title,
      boardTitle: boards.title,
    })
      .from(notifications)
      .leftJoin(profiles, eq(profiles.id, notifications.actorUserId))
      .leftJoin(cards, eq(cards.id, notifications.relatedCardId))
      .leftJoin(boards, eq(boards.id, notifications.relatedBoardId))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit).offset(offset);
    return rows as unknown as NotificationRow[];
  });
}

export async function unreadCount(token: string): Promise<number> {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select({ c: sql<number>`count(*)::int` })
      .from(notifications).where(isNull(notifications.readAt));
    return row?.c ?? 0;
  });
}

export async function isWatchingCard(token: string, cardId: string, userId: string): Promise<boolean> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx.select().from(cardWatchers)
      .where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  });
}
```

Commit: `feat(queries): listNotifications + unreadCount + isWatchingCard`

---

## Task 4: Tests

`tests/integration/notifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { notifications, cardWatchers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl, archiveCardImpl } from "@/actions/cards";
import { createCommentImpl } from "@/actions/comments";
import { toggleCardMemberImpl } from "@/actions/card-members";
import { inviteMemberImpl } from "@/actions/workspace-members";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";
import { markNotificationReadImpl } from "@/actions/notifications";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string, displayName?: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  // displayName is auto-derived from email-local-part by signup trigger;
  // override if provided so @mentions tests are deterministic.
  if (displayName) {
    await service.from("profiles").update({ display_name: displayName }).eq("id", data.user!.id);
  }
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token, email };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("notifications", () => {
  it("@mention creates a comment.mention notification + auto-watch", async () => {
    const owner = await makeUser("nm-o");
    const guest = await makeUser("nm-g", "alice");
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, { workspaceId: ws.id, email: guest.email, role: "member" });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, { cardId: c.id, body: "Hey @alice please review" });

    // alice should have a comment.mention notification.
    const aliceRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(aliceRows.some((r) => r.kind === "comment.mention")).toBe(true);

    // and alice is now an auto-watcher.
    const watchers = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(cardWatchers).where(eq(cardWatchers.cardId, c.id)));
    expect(watchers.some((w) => w.userId === guest.id)).toBe(true);
  });

  it("commenter is auto-watched and gets future notifications", async () => {
    const owner = await makeUser("nw-o");
    const { l } = await setup(owner.jwt);
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, { cardId: c.id, body: "first" });
    const watchers = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(cardWatchers).where(and(
        eq(cardWatchers.cardId, c.id), eq(cardWatchers.userId, owner.id))));
    expect(watchers.length).toBe(1);
    // Self-actions don't notify (emit_notification skips actor==recipient)
  });

  it("assigning a card creates card.assigned notification", async () => {
    const owner = await makeUser("na-o");
    const guest = await makeUser("na-g");
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, { workspaceId: ws.id, email: guest.email, role: "member" });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await toggleCardMemberImpl(owner.jwt, { cardId: c.id, userId: guest.id });

    const guestRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(guestRows.some((r) => r.kind === "card.assigned")).toBe(true);
  });

  it("watcher gets card.archived notification when other user archives", async () => {
    const owner = await makeUser("nx-o", "owner");
    const guest = await makeUser("nx-g", "watcher");
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, { workspaceId: ws.id, email: guest.email, role: "member" });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    // guest must become a board member to add a watcher; for v1 the
    // workspace-owner→board-admin RLS gives them no easy add path.
    // Direct DB watch via service role (test scaffolding):
    await service.from("card_watchers").insert({
      card_id: c.id, user_id: guest.id, board_id: c.boardId, auto: false,
    });
    await archiveCardImpl(owner.jwt, { id: c.id, archived: true });
    const guestRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(guestRows.some((r) => r.kind === "card.archived")).toBe(true);
  });

  it("recipient cannot see other users' notifications", async () => {
    const a = await makeUser("ni-a", "iso-a");
    const b = await makeUser("ni-b", "iso-b");
    const { ws, l } = await setup(a.jwt);
    await inviteMemberImpl(a.jwt, { workspaceId: ws.id, email: b.email, role: "member" });
    const c = await createCardImpl(a.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(a.jwt, { cardId: c.id, body: "@iso-b test" });
    const aRows = await listNotifications(a.jwt, { limit: 10 });
    // a does not see b's mention notification
    expect(aRows.every((r) => r.kind !== "comment.mention")).toBe(true);
  });

  it("markNotificationRead sets readAt; unreadCount drops", async () => {
    const owner = await makeUser("nr-o");
    const guest = await makeUser("nr-g", "guesthandle");
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, { workspaceId: ws.id, email: guest.email, role: "member" });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, { cardId: c.id, body: "@guesthandle hi" });

    const before = await unreadCount(guest.jwt);
    expect(before).toBeGreaterThan(0);
    const list = await listNotifications(guest.jwt, { limit: 1 });
    await markNotificationReadImpl(guest.jwt, { id: list[0].id, read: true });
    const after = await unreadCount(guest.jwt);
    expect(after).toBe(before - 1);
  });
});
```

Run: 6 PASS. Full suite: 74 expected.

Commit: `test(notifications): mentions + auto-watch + archive notify + RLS isolation + read`

---

## Task 5: NotificationBell

`components/nav/notification-bell.tsx`:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { markNotificationRead } from "@/actions/notifications";
import { toast } from "sonner";

type N = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  relatedCardId: string | null;
  relatedBoardId: string | null;
  actorName: string | null;
  cardTitle: string | null;
  boardTitle: string | null;
  readAt: string | null;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  "comment.mention": "mentioned you in",
  "comment.create": "commented on",
  "card.assigned": "assigned you to",
  "card.unassigned": "unassigned you from",
  "card.archived": "archived",
  "card.unarchived": "restored",
  "card.moved": "moved",
  "card.due": "set due date on",
  "card.label.added": "added a label to",
  "board.member.added": "added you to a board",
};

function rel(d: string) {
  const sec = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [, start] = useTransition();

  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    async function refresh() {
      const r = await fetch("/api/notifications/recent", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      if (cancelled) return;
      setItems(data.items);
      setUnread(data.unread);
    }
    refresh();
    const ch = supa.channel(`notif:${userId}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
      () => { void refresh(); },
    ).subscribe();
    return () => { cancelled = true; supa.removeChannel(ch); };
  }, [userId]);

  function markRead(id: string) {
    setItems((curr) => curr.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    setUnread((u) => Math.max(0, u - 1));
    start(async () => {
      try { await markNotificationRead({ id, read: true }); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center size-8 rounded-full text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 chip tabular-nums px-1.5 py-0 text-[10px] bg-fg/15 text-fg ring-1 ring-fg/40">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-auto p-0">
        <div className="px-3 py-2 border-b border-hairline flex items-baseline justify-between">
          <span className="mono-meta">Inbox</span>
          <Link href="/inbox" className="mono-meta-sm text-fg-muted hover:text-fg">VIEW ALL</Link>
        </div>
        {items.length === 0 && (
          <p className="px-3 py-6 text-sm text-fg-faint text-center italic">
            Nothing yet.
          </p>
        )}
        <ul className="divide-y divide-hairline">
          {items.map((n) => (
            <li key={n.id} className="px-3 py-2.5">
              <Link
                href={
                  n.relatedCardId && n.relatedBoardId
                    ? `/b/${n.relatedBoardId}/c/${n.relatedCardId}`
                    : "/inbox"
                }
                onClick={() => !n.readAt && markRead(n.id)}
                className="block"
              >
                <div className="text-sm">
                  <span className="font-medium">{n.actorName ?? "Someone"}</span>
                  <span className="text-fg-muted"> {KIND_LABEL[n.kind] ?? n.kind} </span>
                  <span className="font-medium">{n.cardTitle ?? n.boardTitle ?? "—"}</span>
                </div>
                <div className="mono-meta-sm text-fg-faint mt-0.5 flex justify-between">
                  <span>{n.boardTitle ?? ""}</span>
                  <span>{rel(n.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`app/api/notifications/recent/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";

export async function GET() {
  await requireUser();
  const token = (await getSessionToken())!;
  const [items, unread] = await Promise.all([
    listNotifications(token, { limit: 8 }),
    unreadCount(token),
  ]);
  return NextResponse.json({ items, unread });
}
```

Modify `components/nav/top-nav.tsx`: import + render `<NotificationBell userId={user.id} />` next to the user email.

Commit: `feat(notif): bell dropdown with realtime unread count`

---

## Task 6: Inbox page

`app/(app)/inbox/page.tsx`:

```tsx
import { requireUser, getSessionToken } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";
import { InboxList } from "@/components/inbox/inbox-list";

export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const sp = await searchParams;

  const unreadOnly = sp.filter === "unread";
  const kindFilter = sp.filter === "mentions"
    ? ["comment.mention"]
    : sp.filter === "comments"
    ? ["comment.create", "comment.mention"]
    : sp.filter === "due"
    ? ["card.due"]
    : undefined;

  const items = await listNotifications(token, { limit: 100, unreadOnly, kinds: kindFilter });
  const unread = await unreadCount(token);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <header className="space-y-2">
        <span className="chip">{user.email}</span>
        <h1 className="serif-display text-5xl">Inbox</h1>
        <p className="mono-meta text-fg-muted">{unread} UNREAD · {items.length} SHOWN</p>
      </header>
      <InboxList items={items} activeFilter={sp.filter ?? "all"} />
    </div>
  );
}
```

`components/inbox/inbox-list.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markNotificationRead, markAllRead } from "@/actions/notifications";
import { toast } from "sonner";

const FILTERS = [
  { id: "all", label: "ALL" },
  { id: "unread", label: "UNREAD" },
  { id: "mentions", label: "MENTIONS" },
  { id: "comments", label: "COMMENTS" },
  { id: "due", label: "DUE" },
];

const KIND_LABEL: Record<string, string> = {
  "comment.mention": "mentioned you in",
  "comment.create": "commented on",
  "card.assigned": "assigned you to",
  "card.unassigned": "unassigned you from",
  "card.archived": "archived",
  "card.unarchived": "restored",
  "card.moved": "moved",
  "card.due": "set due date on",
  "card.label.added": "added a label to",
  "board.member.added": "added you to a board",
};

type N = {
  id: string; kind: string;
  relatedCardId: string | null; relatedBoardId: string | null;
  actorName: string | null; cardTitle: string | null; boardTitle: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

export function InboxList({ items, activeFilter }: { items: N[]; activeFilter: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function setFilter(id: string) {
    start(() => router.replace(id === "all" ? pathname : `${pathname}?filter=${id}`));
  }

  function markOne(id: string) {
    start(async () => {
      try { await markNotificationRead({ id, read: true }); router.refresh(); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  function markAll() {
    start(async () => {
      try { await markAllRead(); router.refresh(); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`chip ${activeFilter === f.id ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""}`}
          >
            {f.label}
          </button>
        ))}
        <Button variant="ghost" size="xs" onClick={markAll} disabled={pending} className="ml-auto">
          MARK ALL READ
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-fg-faint italic">Nothing here.</p>
      )}

      <ul className="divide-y divide-hairline glass rounded-2xl">
        {items.map((n) => (
          <li key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.readAt ? "opacity-60" : ""}`}>
            <span
              className="mt-1.5 size-2 rounded-full bg-fg shrink-0"
              style={{ visibility: n.readAt ? "hidden" : "visible" }}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                <span className="font-medium">{n.actorName ?? "Someone"}</span>{" "}
                <span className="text-fg-muted">{KIND_LABEL[n.kind] ?? n.kind}</span>{" "}
                {n.relatedCardId && n.relatedBoardId ? (
                  <Link
                    href={`/b/${n.relatedBoardId}/c/${n.relatedCardId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {n.cardTitle ?? "card"}
                  </Link>
                ) : (
                  <span>{n.boardTitle ?? "—"}</span>
                )}
              </div>
              <div className="mono-meta-sm text-fg-faint">
                {new Date(n.createdAt).toLocaleString()} · {n.boardTitle ?? "—"}
              </div>
            </div>
            {!n.readAt && (
              <Button variant="ghost" size="xs" onClick={() => markOne(n.id)} disabled={pending}>
                MARK READ
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
```

Commit: `feat(inbox): /inbox page with filters + mark-read`

---

## Task 7: Watch toggle on card modal

`components/board/card/watch-toggle.tsx`:

```tsx
"use client";
import { useTransition, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { watchCard, unwatchCard } from "@/actions/watchers";
import { toast } from "sonner";

export function WatchToggle({ cardId }: { cardId: string }) {
  const [watching, setWatching] = useState<boolean | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch(`/api/watchers/check?cardId=${cardId}`)
      .then((r) => (r.ok ? r.json() : { watching: false }))
      .then((d) => setWatching(Boolean(d.watching)))
      .catch(() => setWatching(false));
  }, [cardId]);

  function toggle() {
    if (watching === null) return;
    const next = !watching;
    setWatching(next);
    start(async () => {
      try {
        if (next) await watchCard({ cardId });
        else await unwatchCard({ cardId });
      } catch (err) {
        setWatching(!next);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={watching ? "secondary" : "ghost"}
      size="xs"
      onClick={toggle}
      disabled={pending || watching === null}
      title={watching ? "Watching" : "Watch"}
    >
      {watching ? <Eye className="size-3.5 mr-1" /> : <EyeOff className="size-3.5 mr-1" />}
      {watching ? "WATCHING" : "WATCH"}
    </Button>
  );
}
```

`app/api/watchers/check/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser, getSessionToken } from "@/lib/auth";
import { isWatchingCard } from "@/lib/queries/notifications";

export async function GET(req: Request) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ watching: false });
  const w = await isWatchingCard(token, cardId, user.id);
  return NextResponse.json({ watching: w });
}
```

Modify `components/board/card-modal.tsx`: import + render `<WatchToggle cardId={card.id} />` in the modal's top toolbar (next to TypePicker / ParentPicker).

Commit: `feat(notif): WatchToggle on card modal + check API`

---

## Task 8: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean (now includes `/inbox` route)
- `npm run test:unit` → **74 passing** (68 + 6)
- `npx playwright test` → 6 passing
- Manual smoke:
  1. User A creates a card, comments `@bob hello`. User B (display_name=bob) → bell shows 1.
  2. Click bell → "A mentioned you in [card]" → click → opens card.
  3. Mark all read → bell empties.
  4. Open a card → click WATCH → another user archives → bell shows new card.archived notification.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Notifications-1, §Notifications-2 partial (in-app inbox). Email digest deferred to plan #24.
- **Out of scope:** email/push delivery, smart batching, mention-quick-pick autocomplete in comment composer (later polish).
- **Hazards:**
  - Mention parsing is case-insensitive and matches the user's `display_name` (which defaults to email-local-part). Two users with the same handle = the SQL picks the first by `limit 1`. Acceptable for v1.
  - The `handle_card_update_for_watchers` trigger fires once per card UPDATE; if many fields change at once, multiple notifications can fire. Watchers may be spammy — future polish: collapse same-actor same-card notifications within a short window.
  - `comment.create` notifications go to all watchers including the author. `emit_notification` skips actor==recipient → author won't notify themselves. Good.
  - REST endpoints (`/api/notifications/recent`, `/api/watchers/check`) are simple GETs that respect the user's session via cookies. They do NOT need rate limiting at this scale.
