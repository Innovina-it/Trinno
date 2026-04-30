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
    </div>
  );
}
