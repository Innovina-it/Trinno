import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";
import { InboxList } from "@/components/inbox/inbox-list";
import { InboxSync } from "@/components/inbox/inbox-sync";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const sp = await searchParams;

  const unreadOnly = sp.filter === "unread";
  const kindFilter =
    sp.filter === "mentions"
      ? ["comment.mention"]
      : sp.filter === "comments"
        ? ["comment.create", "comment.mention"]
        : sp.filter === "due"
          ? ["card.due"]
          : undefined;

  const items = await listNotifications(token, {
    limit: 100,
    unreadOnly,
    kinds: kindFilter,
  });
  const unread = await unreadCount(token);

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-6">
      <header className="space-y-1 border-b border-hairline pb-4">
        <span className="mono-meta-sm text-fg-faint">
          {unread} UNREAD · {items.length} SHOWN
        </span>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
          Inbox
        </h1>
      </header>
      <InboxList items={items} activeFilter={sp.filter ?? "all"} />
      <InboxSync userId={user.id} />
      {items.length === 0 && (
        // Plan #16b-γ-C (#8) — empty-state explainer. We render it
        // alongside the InboxList so the filter chips stay reachable
        // (the user might be on UNREAD with stale-but-empty results).
        <div
          className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-3 max-w-md mx-auto"
          data-testid="inbox-empty"
        >
          <p className="mono-meta-sm text-fg-faint">ALL CAUGHT UP</p>
          <p className="text-sm text-fg-muted">
            You will be notified when:
          </p>
          <ul className="text-sm text-fg-muted space-y-1">
            <li>someone @mentions you in a comment</li>
            <li>a card you watch is assigned, archived, or rescheduled</li>
            <li>a due date you own arrives</li>
          </ul>
          <Link
            href="/settings/notifications"
            className="mono-meta-sm text-fg-muted hover:text-fg inline-block pt-1"
          >
            MANAGE SETTINGS →
          </Link>
        </div>
      )}
    </div>
  );
}
