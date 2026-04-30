import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";
import { InboxList } from "@/components/inbox/inbox-list";

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
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <header className="space-y-2">
        <span className="chip">{user.email}</span>
        <h1 className="serif-display text-5xl">Inbox</h1>
        <p className="mono-meta text-fg-muted">
          {unread} UNREAD · {items.length} SHOWN
        </p>
      </header>
      <InboxList items={items} activeFilter={sp.filter ?? "all"} />
      {items.length === 0 && (
        // Plan #16b-γ-C (#8) — empty-state explainer. We render it
        // alongside the InboxList so the filter chips stay reachable
        // (the user might be on UNREAD with stale-but-empty results).
        <div
          className="text-center py-16 space-y-4 max-w-md mx-auto"
          data-testid="inbox-empty"
        >
          <p className="serif-display text-3xl">All caught up.</p>
          <p className="mono-meta-sm text-fg-muted">
            You&rsquo;ll be notified when:
          </p>
          <ul className="text-sm text-fg-muted space-y-1">
            <li>• someone @mentions you in a comment</li>
            <li>• a card you watch is assigned, archived, or rescheduled</li>
            <li>• a due date you own arrives</li>
          </ul>
          <Link
            href="/settings/notifications"
            className="mono-meta-sm underline text-fg-muted hover:text-fg"
          >
            Manage notification settings &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
