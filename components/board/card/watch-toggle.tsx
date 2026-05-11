"use client";
import { useTransition, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { watchCard, unwatchCard } from "@/actions/watchers";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Watcher = {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  auto: boolean;
};

export function WatchToggle({ cardId }: { cardId: string }) {
  const [watching, setWatching] = useState<boolean | null>(null);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [pending, start] = useTransition();

  async function refresh() {
    const r = await fetch(`/api/watchers/check?cardId=${cardId}`, {
      cache: "no-store",
    });
    const d = r.ok ? await r.json() : { watching: false, watchers: [] };
    setWatching(Boolean(d.watching));
    setWatchers(Array.isArray(d.watchers) ? d.watchers : []);
  }

  useEffect(() => {
    refresh()
      .catch(() => {
        setWatching(false);
        setWatchers([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  function toggle() {
    if (watching === null) return;
    const next = !watching;
    setWatching(next);
    start(async () => {
      try {
        if (next) await watchCard({ cardId });
        else await unwatchCard({ cardId });
        await refresh();
      } catch (err) {
        setWatching(!next);
        toast.error((err as Error).message);
      }
    });
  }

  const isOn = watching === true;
  const autoCount = watchers.filter((w) => w.auto).length;
  const manualCount = watchers.length - autoCount;
  const watcherCopy =
    watchers.length === 0
      ? "No watchers yet"
      : `${watchers.length} watching · ${manualCount} manual${autoCount ? `, ${autoCount} auto` : ""}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || watching === null}
        title={isOn ? "Stop watching" : "Watch this card"}
        aria-label={isOn ? "Stop watching this card" : "Watch this card"}
        aria-pressed={isOn}
        data-testid="watch-toggle"
        className={`chip mono-meta-sm inline-flex items-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
          isOn
            ? "bg-fg/10 text-fg ring-1 ring-fg/40"
            : "hover:bg-[rgb(255_255_255/0.08)]"
        }`}
      >
        {isOn ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        {isOn ? "WATCHING" : "WATCH"}
      </button>
      <div
        className="flex items-center gap-1.5 text-xs text-fg-muted"
        data-testid="watchers-summary"
        title={watcherCopy}
      >
        {watchers.length > 0 && (
          <div className="flex -space-x-1">
            {watchers.slice(0, 4).map((w) => (
              <Avatar
                key={w.userId}
                className="size-5 rounded-full border border-hairline-hi bg-surface-strong ring-1 ring-bg-deep"
                title={`${w.displayName}${w.auto ? " · auto-watching" : " · watching"}`}
              >
                <AvatarImage src={w.avatarUrl ?? undefined} />
                <AvatarFallback className="rounded-full bg-fg/10 text-[9px] text-fg">
                  {w.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {watchers.length > 4 && (
              <span className="ml-1 mono-meta-sm text-fg-faint">
                +{watchers.length - 4}
              </span>
            )}
          </div>
        )}
        <span>{watcherCopy}</span>
      </div>
    </div>
  );
}
