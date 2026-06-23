import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import {
  listNotifications,
  countNotifications,
  unreadCount,
} from "@/lib/queries/notifications";
import { InboxList } from "@/components/inbox/inbox-list";
import { InboxSync } from "@/components/inbox/inbox-sync";

// Inbox grows its window in PAGE-sized steps via the `show` URL param,
// capped at SHOW_MAX so a malicious/giant value can't pull unbounded rows.
const PAGE = 100;
const SHOW_MAX = 1000;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; show?: string }>;
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

  const parsedShow = Number.parseInt(sp.show ?? "", 10);
  const show =
    Number.isFinite(parsedShow) && parsedShow > 0
      ? Math.min(parsedShow, SHOW_MAX)
      : PAGE;

  const [items, total, unread] = await Promise.all([
    listNotifications(token, {
      limit: show,
      unreadOnly,
      kinds: kindFilter,
    }),
    countNotifications(token, { unreadOnly, kinds: kindFilter }),
    unreadCount(token),
  ]);

  // Build the Load-more href: bump `show` by one page, preserve the filter.
  const moreParams = new URLSearchParams();
  if (sp.filter) moreParams.set("filter", sp.filter);
  moreParams.set("show", String(Math.min(show + PAGE, SHOW_MAX)));
  const moreHref = `/inbox?${moreParams.toString()}`;
  // Hide Load-more at the safety ceiling — the count still shows the honest
  // total ("1000 OF 1240 SHOWN"), but the button would be a no-op there.
  const hasMore = items.length < total && show < SHOW_MAX;

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-6">
      <header className="space-y-1 border-b border-hairline pb-4">
        <span className="mono-meta-sm text-fg-faint">
          {unread} UNREAD · {items.length} OF {total} SHOWN
        </span>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
          Inbox
        </h1>
      </header>
      <InboxList items={items} activeFilter={sp.filter ?? "all"} />
      {hasMore && (
        <div className="flex justify-center pt-1">
          <Link
            href={moreHref}
            scroll={false}
            data-testid="inbox-load-more"
            className="inline-flex items-center rounded-full border border-hairline bg-[color:var(--surface)] px-4 py-2 text-sm text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            Load more · {total - items.length} more
          </Link>
        </div>
      )}
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
