"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Archive,
  AtSign,
  Bell,
  Calendar,
  CalendarRange,
  CornerUpRight,
  Link2,
  MessageSquare,
  Tag,
  Timer,
  Undo,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  markNotificationRead,
  markAllRead,
} from "@/actions/notifications";
import { undoBus } from "@/lib/undo-bus";
import { toast } from "sonner";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
  { id: "comments", label: "Comments" },
  { id: "due", label: "Due" },
];

type KindMeta = { verb: string; Icon: typeof Bell };
const KIND_META: Record<string, KindMeta> = {
  "comment.mention": { verb: "mentioned you in", Icon: AtSign },
  "comment.create": { verb: "commented on", Icon: MessageSquare },
  "card.assigned": { verb: "assigned you to", Icon: UserPlus },
  "card.unassigned": { verb: "unassigned you from", Icon: Users },
  "card.archived": { verb: "archived", Icon: Archive },
  "card.unarchived": { verb: "restored", Icon: CornerUpRight },
  "card.moved": { verb: "moved", Icon: CornerUpRight },
  "card.due": { verb: "set due date on", Icon: Calendar },
  "card.dates": { verb: "rescheduled", Icon: CalendarRange },
  "card.label.added": { verb: "labeled", Icon: Tag },
  "card.linked": { verb: "linked a card to", Icon: Link2 },
  "card.sprint_changed": { verb: "moved sprint on", Icon: Timer },
  "card.owner_assigned": { verb: "made you owner of", Icon: UserPlus },
  "card.owner_unassigned": { verb: "removed you as owner of", Icon: Users },
  "board.member.added": { verb: "added you to a board", Icon: Users },
};

type N = {
  id: string;
  kind: string;
  relatedCardId: string | null;
  relatedBoardId: string | null;
  actorName: string | null;
  cardTitle: string | null;
  boardTitle: string | null;
  workspaceId: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
  payload?: unknown;
};

function rel(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const sec = Math.round((Date.now() - t.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d`;
  return t
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .toUpperCase();
}

function dayBucket(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const wkAgo = new Date(today);
  wkAgo.setDate(wkAgo.getDate() - 7);
  const tDay = new Date(t);
  tDay.setHours(0, 0, 0, 0);
  if (tDay.getTime() === today.getTime()) return "TODAY";
  if (tDay.getTime() === yest.getTime()) return "YESTERDAY";
  if (tDay.getTime() >= wkAgo.getTime()) return "EARLIER THIS WEEK";
  return "OLDER";
}

function hrefFor(n: N): string {
  if (n.relatedCardId && n.relatedBoardId) {
    if (n.kind === "card.dates" && n.workspaceId) {
      return `/w/${n.workspaceId}/roadmap?focus=${n.relatedCardId}`;
    }
    return `/b/${n.relatedBoardId}/c/${n.relatedCardId}`;
  }
  if (n.relatedBoardId) return `/b/${n.relatedBoardId}`;
  return "/inbox";
}

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
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  // Group rows by day bucket (preserves order).
  const groups = useMemo(() => {
    const out: Array<{ label: string; rows: N[] }> = [];
    for (const n of items) {
      const label = dayBucket(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) {
        last.rows.push(n);
      } else {
        out.push({ label, rows: [n] });
      }
    }
    return out;
  }, [items]);

  // Flat list of rows (for keyboard nav).
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

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
    const wasUnread = items.filter((n) => !n.readAt).map((n) => n.id);
    if (wasUnread.length === 0) return;
    start(async () => {
      try {
        await markAllRead();
        router.refresh();
        undoBus.push({
          message: `Marked ${wasUnread.length} ${wasUnread.length === 1 ? "notification" : "notifications"} read`,
          undo: async () => {
            try {
              await Promise.all(
                wasUnread.map((id) =>
                  markNotificationRead({ id, read: false }),
                ),
              );
              router.refresh();
            } catch (err) {
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  // Keyboard parity: j/k navigate, Enter opens, e marks read, Shift+E marks
  // all read. Guarded so typing in inputs is unaffected.
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (flat.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const n = flat[activeIdx];
        if (n) {
          if (!n.readAt) markOne(n.id);
          router.push(hrefFor(n));
        }
      } else if (e.key === "e" && !e.shiftKey) {
        const n = flat[activeIdx];
        if (n && !n.readAt) markOne(n.id);
      } else if (e.key === "E" && e.shiftKey) {
        markAll();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, activeIdx]);

  // Keep the active row in view.
  useEffect(() => {
    rowRefs.current[activeIdx]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeIdx]);

  // Reset focus when filter changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [activeFilter, items.length]);

  return (
    <div className="space-y-4" data-testid="inbox-list-root">
      <div
        className="flex items-center gap-1.5 overflow-x-auto pb-1"
        data-testid="inbox-filters"
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            data-active={activeFilter === f.id ? "true" : undefined}
            className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
              activeFilter === f.id
                ? "border-fg/40 bg-fg/10 text-fg"
                : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={markAll}
          disabled={pending}
          className="ml-auto shrink-0"
          data-testid="inbox-mark-all"
        >
          <Undo className="size-3" /> Mark all read
        </Button>
      </div>

      {items.length > 0 && (
        <div className="rounded-2xl border border-hairline overflow-hidden bg-[color:var(--surface)]">
          {groups.map((g) => {
            // Compute starting index for keyboard cursor mapping.
            return (
              <section key={g.label}>
                <div className="px-4 py-1.5 mono-meta-sm text-fg-faint border-b border-hairline bg-[color:var(--surface-strong)]">
                  {g.label}
                </div>
                <ul className="divide-y divide-hairline">
                  {g.rows.map((n) => {
                    const flatIdx = flat.indexOf(n);
                    const isActive = flatIdx === activeIdx;
                    const meta = KIND_META[n.kind] ?? {
                      verb: n.kind,
                      Icon: Bell,
                    };
                    const Icon = meta.Icon;
                    return (
                      <li
                        key={n.id}
                        ref={(el) => {
                          rowRefs.current[flatIdx] = el;
                        }}
                        data-active={isActive ? "true" : undefined}
                        data-read={n.readAt ? "true" : undefined}
                        className={`relative flex items-stretch transition-colors ${
                          n.readAt ? "opacity-60" : ""
                        } ${
                          isActive
                            ? "bg-[color:var(--surface-strong)]"
                            : "hover:bg-[color:var(--surface-strong)]"
                        }`}
                      >
                        <Link
                          href={hrefFor(n)}
                          onClick={() => {
                            if (!n.readAt) markOne(n.id);
                          }}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          data-testid="inbox-row"
                          className="flex-1 flex items-start gap-3 px-4 py-3 min-w-0 focus-visible:outline-none"
                        >
                          <span
                            className="mt-1.5 size-2 rounded-full bg-fg shrink-0"
                            style={{
                              visibility: n.readAt ? "hidden" : "visible",
                            }}
                            aria-hidden
                          />
                          <Icon
                            className="size-3.5 mt-0.5 shrink-0 text-fg-muted"
                            aria-hidden
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm leading-snug">
                              <span className="font-medium text-fg">
                                {n.actorName ?? "Someone"}
                              </span>
                              <span className="text-fg-muted"> {meta.verb}</span>
                              <span className="font-medium text-fg">
                                {" "}
                                {(() => {
                                  const p =
                                    n.payload as
                                      | { count?: number }
                                      | null
                                      | undefined;
                                  if (p?.count && p.count > 1) {
                                    return `${p.count} cards`;
                                  }
                                  return (
                                    n.cardTitle ?? n.boardTitle ?? "(item)"
                                  );
                                })()}
                              </span>
                            </div>
                            <div className="mono-meta-sm text-fg-faint mt-0.5 flex items-center gap-2 tabular-nums">
                              {n.boardTitle && (
                                <span className="truncate max-w-[14rem]">
                                  {n.boardTitle}
                                </span>
                              )}
                              <span>·</span>
                              <span>{rel(n.createdAt)}</span>
                            </div>
                          </div>
                        </Link>
                        {!n.readAt && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              markOne(n.id);
                            }}
                            disabled={pending}
                            data-testid="inbox-mark-read"
                            className="px-3 mono-meta-sm text-fg-faint hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                            aria-label="Mark read"
                            title="Mark read (e)"
                          >
                            MARK READ
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div
        className="mono-meta-sm text-fg-faint flex flex-wrap gap-x-4 gap-y-1 px-1"
        aria-hidden
      >
        <span>j/k MOVE</span>
        <span>ENTER OPEN</span>
        <span>e MARK READ</span>
        <span>shift+e MARK ALL</span>
      </div>
    </div>
  );
}
