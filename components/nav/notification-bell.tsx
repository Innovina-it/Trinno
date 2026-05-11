"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
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
  workspaceId: string | null;
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
  "card.completed": "completed",
  "card.moved": "moved",
  "card.due": "set due date on",
  "card.dates": "updated roadmap dates on",
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

function preview(payload: Record<string, unknown>): string | null {
  const p = payload.preview;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let initialFetchDone = false;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;
    async function refresh() {
      const r = await fetch("/api/notifications/recent", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = await r.json();
      if (cancelled) return;
      setItems(data.items);
      setUnread(data.unread);
    }
    void refresh().then(() => {
      initialFetchDone = true;
    });
    let ch: ReturnType<typeof supa.channel> | null = null;
    (async () => {
      // Bind the JWT to the realtime socket BEFORE subscribing — without
      // it the socket carries the anon role and the
      // `notifications_self_select` RLS policy silently drops every CDC
      // event for this user.
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      ch = supa
        .channel(`notif:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_user_id=eq.${userId}`,
          },
          () => {
            void refresh();
            // Only pulse for realtime arrivals (not the initial fetch).
            if (!initialFetchDone || cancelled) return;
            setPulse(true);
            if (pulseTimer) clearTimeout(pulseTimer);
            pulseTimer = setTimeout(() => {
              if (!cancelled) setPulse(false);
            }, 1000);
          },
        )
        .subscribe((status) => {
          if (cancelled) return;
          setSubscribed(status === "SUBSCRIBED");
        });
    })();
    return () => {
      cancelled = true;
      if (pulseTimer) clearTimeout(pulseTimer);
      if (ch) void supa.removeChannel(ch);
    };
  }, [userId]);

  function markRead(id: string) {
    setItems((curr) =>
      curr.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
      ),
    );
    setUnread((u) => Math.max(0, u - 1));
    start(async () => {
      try {
        await markNotificationRead({ id, read: true });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [@media(hover:none)_and_(pointer:coarse)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:min-w-11"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        data-realtime-ready={subscribed ? "true" : undefined}
      >
        <Bell className={`size-4 ${pulse ? "animate-pulse" : ""}`} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 chip tabular-nums px-1.5 py-0 text-[10px] bg-fg/15 text-fg ring-1 ring-fg/40">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(calc(100vw-1rem),20rem)] max-h-[min(70dvh,24rem)] overflow-auto p-0"
      >
        <div className="px-3 py-2 border-b border-hairline flex items-baseline justify-between">
          <span className="mono-meta">Inbox</span>
          <Link
            href="/inbox"
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            VIEW ALL
          </Link>
        </div>
        {items.length === 0 && (
          <div className="px-3 py-6 text-center space-y-1">
            <p className="mono-meta-sm text-fg-faint">NOTHING YET</p>
            <p className="text-sm text-fg-muted">
              You will see activity here.
            </p>
          </div>
        )}
        <ul className="divide-y divide-hairline">
          {items.map((n) => (
            <li key={n.id} className="px-3 py-2.5">
              <Link
                href={
                  n.relatedCardId && n.relatedBoardId
                    ? n.kind === "card.dates" && n.workspaceId
                      ? `/w/${n.workspaceId}/roadmap?focus=${n.relatedCardId}`
                      : `/b/${n.relatedBoardId}/c/${n.relatedCardId}`
                    : "/inbox"
                }
                onClick={() => !n.readAt && markRead(n.id)}
                className="block"
              >
                <div className="text-sm">
                  <span className="font-medium">
                    {n.actorName ?? "Someone"}
                  </span>
                  <span className="text-fg-muted">
                    {" "}
                    {KIND_LABEL[n.kind] ?? n.kind}{" "}
                  </span>
                  <span className="font-medium">
                    {n.cardTitle ?? n.boardTitle ?? "—"}
                  </span>
                </div>
                <div className="mono-meta-sm text-fg-faint mt-0.5 flex justify-between">
                  <span>{n.boardTitle ?? ""}</span>
                  <span>{rel(n.createdAt)}</span>
                </div>
                {preview(n.payload) && (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-muted">
                    {preview(n.payload)}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
