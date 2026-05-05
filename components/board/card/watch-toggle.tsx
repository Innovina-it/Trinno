"use client";
import { useTransition, useEffect, useState } from "react";
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

  const isOn = watching === true;
  return (
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
  );
}
