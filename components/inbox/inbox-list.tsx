"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  markNotificationRead,
  markAllRead,
} from "@/actions/notifications";
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
  id: string;
  kind: string;
  relatedCardId: string | null;
  relatedBoardId: string | null;
  actorName: string | null;
  cardTitle: string | null;
  boardTitle: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

export function InboxList({
  items,
  activeFilter,
}: {
  items: N[];
  activeFilter: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function setFilter(id: string) {
    start(() =>
      router.replace(id === "all" ? pathname : `${pathname}?filter=${id}`),
    );
  }

  function markOne(id: string) {
    start(async () => {
      try {
        await markNotificationRead({ id, read: true });
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function markAll() {
    start(async () => {
      try {
        await markAllRead();
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
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
        <Button
          variant="ghost"
          size="xs"
          onClick={markAll}
          disabled={pending}
          className="ml-auto"
        >
          MARK ALL READ
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-fg-faint italic">Nothing here.</p>
      )}

      <ul className="divide-y divide-hairline glass rounded-2xl">
        {items.map((n) => (
          <li
            key={n.id}
            className={`px-4 py-3 flex items-start gap-3 ${n.readAt ? "opacity-60" : ""}`}
          >
            <span
              className="mt-1.5 size-2 rounded-full bg-fg shrink-0"
              style={{ visibility: n.readAt ? "hidden" : "visible" }}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                <span className="font-medium">{n.actorName ?? "Someone"}</span>{" "}
                <span className="text-fg-muted">
                  {KIND_LABEL[n.kind] ?? n.kind}
                </span>{" "}
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
              <Button
                variant="ghost"
                size="xs"
                onClick={() => markOne(n.id)}
                disabled={pending}
              >
                MARK READ
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
