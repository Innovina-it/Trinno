"use client";
import { useTransition, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

  return (
    <Button
      type="button"
      variant={watching ? "secondary" : "ghost"}
      size="xs"
      onClick={toggle}
      disabled={pending || watching === null}
      title={watching ? "Watching" : "Watch"}
      data-testid="watch-toggle"
    >
      {watching ? (
        <Eye className="size-3.5 mr-1" />
      ) : (
        <EyeOff className="size-3.5 mr-1" />
      )}
      {watching ? "WATCHING" : "WATCH"}
    </Button>
  );
}
