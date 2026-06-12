"use client";
import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { logWork, deleteWorklog } from "@/actions/worklogs";
import { updateCard } from "@/actions/cards";
import { Hourglass, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { optimisticWrite } from "@/lib/optimistic-write";
import { formatDate } from "@/lib/format-date";

type WorklogRow = {
  id: string;
  minutes: number;
  comment: string | null;
  startedAt: Date | string;
  userName: string | null;
};

export function TimeSection({
  cardId,
  estimateMin,
  spentMin,
}: {
  cardId: string;
  estimateMin: number | null;
  spentMin: number;
}) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const isGuest = useIsGuest();
  const [estimate, setEstimate] = useState<string>(
    estimateMin?.toString() ?? "",
  );
  const [showLog, setShowLog] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [comment, setComment] = useState("");
  const [worklogs, setWorklogs] = useState<WorklogRow[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch(`/api/worklogs?cardId=${cardId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setWorklogs(d.items ?? []))
      .catch(() => setWorklogs([]));
  }, [cardId, pending]);

  function saveEstimate() {
    const n = estimate.trim() === "" ? null : Number(estimate);
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      toast.error("Non-negative integer.");
      return;
    }
    if (n === estimateMin) return;
    const prev = estimateMin;
    start(async () => {
      // instant-feedback A1 — local apply runs before the server write,
      // so the field no longer waits on the round-trip.
      await optimisticWrite<number | null>({
        prev,
        next: n,
        apply: (v) => {
          setEstimate(v?.toString() ?? "");
          updateCardLocal(cardId, { estimateMin: v } as {
            estimateMin: number | null;
          });
        },
        write: (v) => updateCard({ id: cardId, estimateMin: v }),
        message: n == null ? "Estimate cleared" : "Estimate updated",
      }).catch(() => {});
    });
  }

  function logOne(e: React.FormEvent) {
    e.preventDefault();
    const m = Number(minutes);
    if (!Number.isInteger(m) || m <= 0) {
      toast.error("Minutes > 0.");
      return;
    }
    start(async () => {
      try {
        await logWork({ cardId, minutes: m, comment: comment || null });
        setMinutes("");
        setComment("");
        setShowLog(false);
        toast.success(`Logged ${m}m`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function delOne(id: string) {
    start(async () => {
      try {
        await deleteWorklog({ id });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (isGuest) {
    if (estimateMin == null && spentMin === 0) return null;
    return (
      <div className="space-y-2" data-testid="time-section">
        <h3 className="mono-meta text-fg flex items-center gap-1">
          <Hourglass className="size-3" /> Time
        </h3>
        <p className="text-sm text-fg tabular-nums">
          {spentMin}m / {estimateMin == null ? "—" : `${estimateMin}m`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="time-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg flex items-center gap-1">
          <Hourglass className="size-3" /> Time
        </h3>
        <span className="mono-meta-sm text-fg-faint tabular-nums">
          {spentMin}m / {estimateMin == null ? "—" : `${estimateMin}m`}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor={`est-${cardId}`}>Estimate (min)</Label>
          <Input
            id={`est-${cardId}`}
            type="number"
            min={0}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="e.g. 120"
          />
        </div>
        <Button size="sm" onClick={saveEstimate} disabled={pending}>
          SAVE
        </Button>
      </div>

      {!showLog ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowLog(true)}
        >
          <Plus className="size-3.5 mr-1" /> Log work
        </Button>
      ) : (
        <form onSubmit={logOne} className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="space-y-1.5 w-32">
              <Label htmlFor={`min-${cardId}`}>Minutes</Label>
              <Input
                id={`min-${cardId}`}
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <Label htmlFor={`cmt-${cardId}`}>Comment (optional)</Label>
              <Input
                id={`cmt-${cardId}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                placeholder="What did you work on?"
              />
            </div>
            <Button type="submit" size="sm" disabled={pending || !minutes}>
              LOG
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowLog(false)}
            >
              ×
            </Button>
          </div>
        </form>
      )}

      {worklogs.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {worklogs.map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="tabular-nums mono-meta-sm w-12">
                {w.minutes}m
              </span>
              <span className="flex-1 truncate">
                {w.comment || (
                  <span className="text-fg-faint italic">no note</span>
                )}
              </span>
              <span className="mono-meta-sm text-fg-faint">
                {w.userName ?? "—"}
              </span>
              <span className="mono-meta-sm text-fg-faint">
                {formatDate(w.startedAt)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => delOne(w.id)}
                disabled={pending}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
