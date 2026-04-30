# Plan #18 — Automation Rules Engine

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Per-board "when X → if Y → do Z" rules. Triggers fire from activity events. Conditions filter. Actions mutate state, post comments, send notifications, hit webhooks.

**Architecture:** Synchronous in-process executor invoked by an `AFTER INSERT` trigger on `activity` (via `pg_notify('rule_dispatch', payload)`) AND by an explicit `dispatchRule(activityRow)` call from the Server Action wrappers (so rules fire even without a Postgres listener running). For local dev + Vercel deploy, use the Server-Action-side dispatch as the primary path; pg_notify is a future hook for an out-of-process worker.

**No external worker required for v1.** Every Server Action that creates an activity row also invokes the rule engine inline (in the same request). Slow actions (e.g. webhook POST) run via `await fetch(...)` non-blocking after the user's mutation returns.

**Rules table:**
- `trigger jsonb` — `{kind: "card.move", from_list?, to_list?}`, `{kind: "card.label.add", label_id?}`, `{kind: "card.due"}`, etc.
- `conditions jsonb` — `{all: [...]}` or `{any: [...]}`. Each predicate `{field: "type", op: "eq", value: "bug"}`.
- `actions jsonb[]` — `[{kind: "set_label", label_id}, {kind: "assign", user_id}, {kind: "move_to_list", list_id}, {kind: "add_comment", body}, {kind: "notify_slack", url, message}, {kind: "webhook_post", url, secret?}]`.

**Out of scope (deferred):**
- Rule scheduling (cron-style "every Monday at 9am") → plan #18b
- Branching / multi-step rules
- A visual no-code rule builder (this slice ships a JSON editor; a node-based UI lands in plan #18b)

**Definition of done:**
- A board admin can write a rule via JSON editor and see it execute on matching events.
- Rule run log shows last 100 runs per rule with status, ms, payload, error.
- Default actions work: `set_label`, `assign`, `move_to_list`, `add_comment`, `webhook_post`.
- RLS: only board members read rules; only board admins write.
- New tests cover: rule fires on event, condition filters correctly, action executes, run log written.

---

## Files

**Migrations:**
- `supabase/migrations/0030_rules.sql`

**Schema:** append `rules`, `ruleRuns` to `lib/db/schema.ts`.

**Validation:** `lib/validation.ts` — `RuleTrigger`, `RuleCondition`, `RuleAction`, `CreateRuleInput`, `UpdateRuleInput`, `DeleteRuleInput`, `ToggleRuleInput`.

**Engine:**
- `lib/rules/types.ts` — TypeScript types for trigger/condition/action JSON.
- `lib/rules/match.ts` — `matchTrigger(rule, event)`, `evalConditions(rule, ctx)`.
- `lib/rules/execute.ts` — `executeRule(token, rule, ctx)` runs each action.
- `lib/rules/dispatch.ts` — `dispatchRulesForEvent(token, boardId, event, ctx)` loads enabled rules, matches, executes.

**Hook into Server Actions:**
- `actions/cards.ts`, `actions/lists.ts`, `actions/comments.ts`, `actions/card-members.ts`, `actions/labels.ts` (the ones that create activity).
- After successful mutation, call `await dispatchRulesForEvent(token, boardId, event, ctx)`.

**Read helpers:** `lib/queries/rules.ts` — `listRules(token, boardId)`, `listRuleRuns(token, ruleId, limit)`.

**Server actions:** `actions/rules.ts` — create / update / delete / toggle.

**Components:**
- `components/board/rules/rules-panel.tsx` (server) — list of rules + create button.
- `components/board/rules/rule-editor-dialog.tsx` (client) — JSON editor (textarea) + validate-on-blur.
- `components/board/rules/rule-runs-drawer.tsx` (client) — recent runs.

**Routes:**
- modify `app/(app)/b/[boardId]/settings/page.tsx` to include the rules panel.

**Tests:**
- `tests/integration/rules.test.ts` — rule create/update/toggle/delete + match logic.
- `tests/unit/rules-match.test.ts` — pure trigger/condition matcher tests (10+ cases).

---

## Task 1: Migration + schema

**Files:** `supabase/migrations/0030_rules.sql`, `lib/db/schema.ts`.

```sql
-- 0030_rules.sql
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger jsonb not null,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.rules (board_id, enabled);

create table public.rule_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  board_id uuid not null,  -- denorm
  status text not null check (status in ('success','partial','failed','skipped')),
  triggered_at timestamptz not null default now(),
  duration_ms int not null default 0,
  event jsonb not null,
  error text,
  action_results jsonb not null default '[]'::jsonb
);
create index on public.rule_runs (rule_id, triggered_at desc);

alter table public.rules enable row level security;
alter table public.rule_runs enable row level security;

create policy rules_select on public.rules for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid()
  ));
create policy rules_admin_insert on public.rules for insert
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));
create policy rules_admin_update on public.rules for update
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));
create policy rules_admin_delete on public.rules for delete
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));

create policy rule_runs_select on public.rule_runs for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rule_runs.board_id and bm.user_id = auth.uid()
  ));

-- Rule runs are written via SECURITY DEFINER from the engine (server-side service role).
-- No INSERT/UPDATE/DELETE policy for end users.

alter publication supabase_realtime add table public.rules;
alter publication supabase_realtime add table public.rule_runs;
```

Drizzle (append):
```ts
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").notNull(),
  conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
  actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ruleRuns = pgTable("rule_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id").notNull(),
  boardId: uuid("board_id").notNull(),
  status: text("status").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  event: jsonb("event").notNull(),
  error: text("error"),
  actionResults: jsonb("action_results").notNull().default(sql`'[]'::jsonb`),
});
```

Apply migration + restart kong. Tests pass. Commit `feat(db): rules + rule_runs tables with admin RLS`.

---

## Task 2: Validation + types

`lib/rules/types.ts`:

```ts
export type RuleEvent =
  | { kind: "card.create"; cardId: string; listId: string; boardId: string }
  | { kind: "card.move"; cardId: string; fromListId: string; toListId: string; boardId: string }
  | { kind: "card.archive"; cardId: string; boardId: string }
  | { kind: "card.unarchive"; cardId: string; boardId: string }
  | { kind: "card.due"; cardId: string; dueDate: string | null; dueComplete: boolean; boardId: string }
  | { kind: "card.label.add"; cardId: string; labelId: string; boardId: string }
  | { kind: "card.label.remove"; cardId: string; labelId: string; boardId: string }
  | { kind: "card.member.assign"; cardId: string; userId: string; boardId: string }
  | { kind: "card.member.unassign"; cardId: string; userId: string; boardId: string }
  | { kind: "comment.create"; cardId: string; commentId: string; boardId: string };

export type RuleTrigger = {
  kind: RuleEvent["kind"];
  from_list?: string;
  to_list?: string;
  label_id?: string;
};

export type RuleConditionPredicate =
  | { field: "type"; op: "eq" | "neq"; value: string }
  | { field: "title"; op: "contains" | "matches"; value: string }
  | { field: "list_id"; op: "eq" | "neq"; value: string }
  | { field: "label_count"; op: "eq" | "gte" | "lte"; value: number }
  | { field: "story_points"; op: "eq" | "gte" | "lte"; value: number }
  | { field: "has_label"; op: "eq"; value: string };

export type RuleConditions =
  | { all: RuleConditionPredicate[] }
  | { any: RuleConditionPredicate[] }
  | Record<string, never>;  // empty = always true

export type RuleAction =
  | { kind: "set_label"; label_id: string }
  | { kind: "remove_label"; label_id: string }
  | { kind: "assign"; user_id: string }
  | { kind: "unassign"; user_id: string }
  | { kind: "move_to_list"; list_id: string }
  | { kind: "set_type"; value: "epic" | "story" | "task" | "subtask" | "bug" }
  | { kind: "add_comment"; body: string }
  | { kind: "set_due_complete"; value: boolean }
  | { kind: "webhook_post"; url: string; secret?: string };
```

`lib/validation.ts` (append):
```ts
const RuleTriggerSchema = z.object({
  kind: z.enum([
    "card.create","card.move","card.archive","card.unarchive","card.due",
    "card.label.add","card.label.remove","card.member.assign","card.member.unassign",
    "comment.create",
  ]),
  from_list: Uuid.optional(),
  to_list: Uuid.optional(),
  label_id: Uuid.optional(),
}).passthrough();

const PredicateSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.union([z.string(), z.number()]),
});
const ConditionsSchema = z.union([
  z.object({ all: z.array(PredicateSchema) }),
  z.object({ any: z.array(PredicateSchema) }),
  z.object({}).strict(),
]);

const ActionSchema = z.object({
  kind: z.enum([
    "set_label","remove_label","assign","unassign","move_to_list",
    "set_type","add_comment","set_due_complete","webhook_post",
  ]),
}).passthrough();

export const CreateRuleInput = z.object({
  boardId: Uuid,
  name: z.string().trim().min(1).max(120),
  trigger: RuleTriggerSchema,
  conditions: ConditionsSchema.default({}),
  actions: z.array(ActionSchema).min(1).max(20),
});

export const UpdateRuleInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(120).optional(),
  trigger: RuleTriggerSchema.optional(),
  conditions: ConditionsSchema.optional(),
  actions: z.array(ActionSchema).min(1).max(20).optional(),
});

export const DeleteRuleInput = z.object({ id: Uuid });
export const ToggleRuleInput = z.object({ id: Uuid, enabled: z.boolean() });
```

Commit `feat(rules): validation schemas + RuleEvent/Trigger/Condition/Action types`.

---

## Task 3: Match + condition evaluator (TDD)

`lib/rules/match.ts`:

```ts
import type { RuleTrigger, RuleConditions, RuleEvent } from "./types";

export function matchTrigger(trigger: RuleTrigger, event: RuleEvent): boolean {
  if (trigger.kind !== event.kind) return false;
  if (event.kind === "card.move") {
    if (trigger.from_list && trigger.from_list !== event.fromListId) return false;
    if (trigger.to_list && trigger.to_list !== event.toListId) return false;
  }
  if (event.kind === "card.label.add" || event.kind === "card.label.remove") {
    if (trigger.label_id && trigger.label_id !== event.labelId) return false;
  }
  return true;
}

export type MatchContext = {
  card?: {
    type: string; title: string; listId: string;
    storyPoints: number | null;
    labelIds: string[];
  };
};

export function evalConditions(conditions: RuleConditions, ctx: MatchContext): boolean {
  if ("all" in conditions) return conditions.all.every((p) => evalPredicate(p, ctx));
  if ("any" in conditions) return conditions.any.some((p) => evalPredicate(p, ctx));
  return true;
}

function evalPredicate(p: { field: string; op: string; value: unknown }, ctx: MatchContext): boolean {
  if (!ctx.card) return false;
  const v = (() => {
    switch (p.field) {
      case "type": return ctx.card!.type;
      case "title": return ctx.card!.title;
      case "list_id": return ctx.card!.listId;
      case "label_count": return ctx.card!.labelIds.length;
      case "story_points": return ctx.card!.storyPoints ?? 0;
      case "has_label": return ctx.card!.labelIds.includes(String(p.value));
      default: return null;
    }
  })();
  switch (p.op) {
    case "eq":  return v === p.value || (p.field === "has_label" && v === true);
    case "neq": return v !== p.value;
    case "gte": return typeof v === "number" && v >= Number(p.value);
    case "lte": return typeof v === "number" && v <= Number(p.value);
    case "contains": return typeof v === "string" && v.toLowerCase().includes(String(p.value).toLowerCase());
    case "matches":  return typeof v === "string" && new RegExp(String(p.value)).test(v);
    default: return false;
  }
}
```

`tests/unit/rules-match.test.ts` (TDD — write first):

```ts
import { describe, it, expect } from "vitest";
import { matchTrigger, evalConditions } from "@/lib/rules/match";

const baseCard = {
  type: "task", title: "Fix login bug", listId: "L1",
  storyPoints: 5, labelIds: ["lbl-bug"],
};

describe("matchTrigger", () => {
  it("matches kind", () => {
    expect(matchTrigger({ kind: "card.create" }, { kind: "card.create", cardId: "c", listId: "L", boardId: "B" })).toBe(true);
    expect(matchTrigger({ kind: "card.archive" }, { kind: "card.create", cardId: "c", listId: "L", boardId: "B" })).toBe(false);
  });
  it("filters card.move by from/to list", () => {
    const ev = { kind: "card.move" as const, cardId: "c", fromListId: "A", toListId: "B", boardId: "B" };
    expect(matchTrigger({ kind: "card.move", from_list: "A" }, ev)).toBe(true);
    expect(matchTrigger({ kind: "card.move", from_list: "Z" }, ev)).toBe(false);
    expect(matchTrigger({ kind: "card.move", to_list: "B" }, ev)).toBe(true);
    expect(matchTrigger({ kind: "card.move", to_list: "Z" }, ev)).toBe(false);
  });
  it("filters label.add by label_id", () => {
    const ev = { kind: "card.label.add" as const, cardId: "c", labelId: "L1", boardId: "B" };
    expect(matchTrigger({ kind: "card.label.add", label_id: "L1" }, ev)).toBe(true);
    expect(matchTrigger({ kind: "card.label.add", label_id: "L2" }, ev)).toBe(false);
  });
});

describe("evalConditions", () => {
  it("empty conditions = always true", () => {
    expect(evalConditions({}, { card: baseCard })).toBe(true);
  });
  it("all: every predicate must pass", () => {
    expect(evalConditions({ all: [{ field: "type", op: "eq", value: "task" }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ all: [{ field: "type", op: "eq", value: "task" }, { field: "story_points", op: "gte", value: 3 }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ all: [{ field: "type", op: "eq", value: "task" }, { field: "story_points", op: "gte", value: 100 }] }, { card: baseCard })).toBe(false);
  });
  it("any: at least one passes", () => {
    expect(evalConditions({ any: [{ field: "type", op: "eq", value: "bug" }, { field: "story_points", op: "gte", value: 3 }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ any: [{ field: "type", op: "eq", value: "bug" }, { field: "story_points", op: "gte", value: 100 }] }, { card: baseCard })).toBe(false);
  });
  it("title contains/matches", () => {
    expect(evalConditions({ all: [{ field: "title", op: "contains", value: "login" }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ all: [{ field: "title", op: "matches", value: "^Fix" }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ all: [{ field: "title", op: "matches", value: "^Hotfix" }] }, { card: baseCard })).toBe(false);
  });
  it("has_label", () => {
    expect(evalConditions({ all: [{ field: "has_label", op: "eq", value: "lbl-bug" }] }, { card: baseCard })).toBe(true);
    expect(evalConditions({ all: [{ field: "has_label", op: "eq", value: "lbl-other" }] }, { card: baseCard })).toBe(false);
  });
});
```

Run, expect FAIL → write match.ts → PASS.

Commit `feat(rules): match + evalConditions + unit tests`.

---

## Task 4: Action executor

`lib/rules/execute.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, cardLabels, cardMembers, lists } from "@/lib/db/schema";
import { positionBetween } from "@/lib/ordering";
import { sql } from "drizzle-orm";
import type { RuleAction, RuleEvent } from "./types";

export type ActionResult = { kind: string; ok: boolean; error?: string };

export async function executeAction(
  token: string,
  action: RuleAction,
  event: RuleEvent,
  serviceClient?: { fetch: typeof fetch },
): Promise<ActionResult> {
  try {
    const cardId = (event as { cardId?: string }).cardId;
    switch (action.kind) {
      case "set_label":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.insert(cardLabels)
            .values({ cardId, labelId: action.label_id, boardId: "00000000-0000-0000-0000-000000000000" })
            .onConflictDoNothing();
        });
        return { kind: action.kind, ok: true };

      case "remove_label":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.delete(cardLabels).where(and(
            eq(cardLabels.cardId, cardId),
            eq(cardLabels.labelId, action.label_id),
          ));
        });
        return { kind: action.kind, ok: true };

      case "assign":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.insert(cardMembers)
            .values({ cardId, userId: action.user_id, boardId: "00000000-0000-0000-0000-000000000000" })
            .onConflictDoNothing();
        });
        return { kind: action.kind, ok: true };

      case "unassign":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.delete(cardMembers).where(and(
            eq(cardMembers.cardId, cardId),
            eq(cardMembers.userId, action.user_id),
          ));
        });
        return { kind: action.kind, ok: true };

      case "move_to_list":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          // Append to end of target list
          const [last] = await tx.select({ position: cards.position })
            .from(cards)
            .where(eq(cards.listId, action.list_id))
            .orderBy(sql`${cards.position} desc`)
            .limit(1);
          const newPos = positionBetween(last?.position ?? null, null);
          await tx.update(cards)
            .set({ listId: action.list_id, position: newPos })
            .where(eq(cards.id, cardId));
        });
        return { kind: action.kind, ok: true };

      case "set_type":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.update(cards).set({ type: action.value }).where(eq(cards.id, cardId));
        });
        return { kind: action.kind, ok: true };

      case "set_due_complete":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.update(cards).set({ dueComplete: action.value }).where(eq(cards.id, cardId));
        });
        return { kind: action.kind, ok: true };

      case "add_comment":
        if (!cardId) throw new Error("event has no cardId");
        await dbAsUser(token, async (tx) => {
          await tx.execute(sql`
            insert into public.comments (card_id, board_id, author_id, body)
            values (${cardId}, ${event.boardId}, auth.uid(), ${action.body})
          `);
        });
        return { kind: action.kind, ok: true };

      case "webhook_post": {
        const f = serviceClient?.fetch ?? fetch;
        const body = JSON.stringify({ event, ts: new Date().toISOString() });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (action.secret) {
          // Simple HMAC-SHA256 signature for receivers to verify
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw", enc.encode(action.secret),
            { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
          );
          const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
          headers["X-Signature-256"] = "sha256=" + Buffer.from(new Uint8Array(sig)).toString("hex");
        }
        const r = await f(action.url, { method: "POST", headers, body });
        if (!r.ok) throw new Error(`webhook ${action.url} → ${r.status}`);
        return { kind: action.kind, ok: true };
      }
    }
  } catch (err) {
    return { kind: action.kind, ok: false, error: (err as Error).message };
  }
}
```

Commit `feat(rules): action executor for 9 action kinds incl webhook_post HMAC`.

---

## Task 5: Dispatcher

`lib/rules/dispatch.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { eq, and, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { rules, ruleRuns, cards, cardLabels } from "@/lib/db/schema";
import type { RuleEvent } from "./types";
import { matchTrigger, evalConditions } from "./match";
import { executeAction, type ActionResult } from "./execute";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function dispatchRulesForEvent(
  token: string,
  event: RuleEvent,
): Promise<void> {
  // Load enabled rules for this board
  const matching = await dbAsUser(token, async (tx) => {
    return tx.select().from(rules)
      .where(and(eq(rules.boardId, event.boardId), eq(rules.enabled, true)));
  });
  if (matching.length === 0) return;

  // Build context: load card + its labels (if event has cardId)
  let ctx: { card?: { type: string; title: string; listId: string; storyPoints: number | null; labelIds: string[] } } = {};
  const cid = (event as { cardId?: string }).cardId;
  if (cid) {
    const [card] = await dbAsUser(token, async (tx) => {
      return tx.select().from(cards).where(eq(cards.id, cid));
    });
    if (card) {
      const labelRows = await dbAsUser(token, async (tx) =>
        tx.select({ labelId: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, cid))
      );
      ctx = {
        card: {
          type: card.type, title: card.title, listId: card.listId,
          storyPoints: card.storyPoints,
          labelIds: labelRows.map((r) => r.labelId),
        },
      };
    }
  }

  for (const rule of matching) {
    const trigger = rule.trigger as never;
    if (!matchTrigger(trigger as never, event)) continue;
    if (!evalConditions((rule.conditions ?? {}) as never, ctx)) continue;

    const startAt = Date.now();
    const results: ActionResult[] = [];
    let allOk = true;
    for (const a of (rule.actions as never as Array<never>)) {
      const r = await executeAction(token, a as never, event);
      results.push(r);
      if (!r.ok) allOk = false;
    }

    // Record run via service role (bypass RLS — rule_runs has no INSERT for users)
    await admin.from("rule_runs").insert({
      rule_id: rule.id,
      board_id: rule.boardId,
      status: results.length === 0 ? "skipped" : allOk ? "success" : (results.some(r => r.ok) ? "partial" : "failed"),
      duration_ms: Date.now() - startAt,
      event,
      action_results: results,
      error: allOk ? null : results.find(r => !r.ok)?.error ?? null,
    });
  }
}
```

Commit `feat(rules): dispatchRulesForEvent + rule_runs persistence via service role`.

---

## Task 6: Hook into Server Actions

Modify these action wrappers to call `dispatchRulesForEvent` AFTER the impl returns successfully:

- `actions/cards.ts`:
  - `createCard` → `dispatchRulesForEvent(token, { kind: "card.create", cardId: r.id, listId: r.listId, boardId: r.boardId })`
  - `moveCard` → `{ kind: "card.move", cardId: r.id, fromListId: prev?.listId ?? r.listId, toListId: r.listId, boardId: r.boardId }` (need to fetch prev first OR pass via input)
  - `archiveCard` → `{ kind: r.archived ? "card.archive" : "card.unarchive", cardId: r.id, boardId: r.boardId }`
  - `updateCard` → if dueDate or dueComplete changed: `{ kind: "card.due", cardId: r.id, dueDate: r.dueDate?.toISOString() ?? null, dueComplete: r.dueComplete, boardId: r.boardId }`
- `actions/labels.ts` `toggleCardLabel` → `attached ? "card.label.add" : "card.label.remove"`
- `actions/card-members.ts` `toggleCardMember` → similarly
- `actions/comments.ts` `createComment` → `{ kind: "comment.create", cardId, commentId: r.id, boardId: r.boardId }`

Use try/catch on the dispatch — never let rule failures break the user mutation. Just log + continue.

Pattern:
```ts
try { await dispatchRulesForEvent(token, event); }
catch (err) { console.error("rule dispatch failed:", err); }
```

Commit `feat(rules): wire dispatchRulesForEvent into card/label/member/comment actions`.

---

## Task 7: Rule actions + queries

`actions/rules.ts` — CRUD with impl/wrapper, idempotent on duplicate names disallowed.

`lib/queries/rules.ts`:
```ts
export async function listRules(token: string, boardId: string) { /* ... */ }
export async function listRuleRuns(token: string, ruleId: string, limit = 100) { /* ... */ }
```

Commit `feat(rules): CRUD actions + listRules/listRuleRuns queries`.

---

## Task 8: Integration tests

`tests/integration/rules.test.ts`:

1. Create rule with `{ kind: "card.create" }` trigger + `[{ kind: "set_type", value: "bug" }]` action → create a card → assert card.type === "bug".
2. Create rule with `{ kind: "card.move", to_list: "L2" }` → move card to L2 → assert action ran.
3. Conditions filter: rule fires only when `type=task` → create epic card → no run.
4. Disabled rule: enabled=false → no run.
5. Non-admin cannot create a rule (RLS).

Run integration suite — 84 expected (79 + 5 new).

Commit `test(rules): create/match/condition/disable/RLS`.

---

## Task 9: UI

`components/board/rules/rules-panel.tsx` (server) — list rules + new button.
`components/board/rules/rule-editor-dialog.tsx` (client):
  - JSON textarea for trigger / conditions / actions (3 areas).
  - Validate on blur via the validation schemas; show inline errors.
  - Save button disabled until valid.
`components/board/rules/rule-runs-drawer.tsx` (client) — recent runs list.

Modify `app/(app)/b/[boardId]/settings/page.tsx` to mount `<RulesPanel boardId={boardId} />`.

Commit `feat(rules): rules panel + JSON editor + run drawer in board settings`.

---

## Task 10: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run test:unit` → 84 + ~10 unit (rules-match) = ~94 expected
- `npx playwright test` → 6 passing

---

## Self-Review Notes

- **In-process dispatch** is the v1 trade-off: no separate worker, no pg_notify listener, but rule actions add latency to user mutations. Mitigation: actions are short (single SQL) except `webhook_post` which is fire-and-forget-ish (we await but timeout via fetch's 30s default).
- **No rate limiting on webhook_post** — a malicious/poorly-configured rule could DoS an external service. Plan #19 (REST/webhooks) hardens this with retry+backoff queue.
- **Rule edit UI is JSON** — power-user friendly but not no-code. Plan #18b can add a node-based builder.
- **Recursion guard absent** — a rule that fires on `card.move` and runs a `move_to_list` action could loop. The action invokes `tx.update` directly (not `moveCardImpl`), so no nested dispatch happens. Safe.
- **Out of scope:** rule scheduling, multi-board rules, dry-run mode, rule history rollback.
