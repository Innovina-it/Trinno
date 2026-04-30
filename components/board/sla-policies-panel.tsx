"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy,
  scanBoardSla,
} from "@/actions/sla";
import { toast } from "sonner";
import { Trash2, Plus, RotateCw } from "lucide-react";

type Pol = {
  id: string;
  name: string;
  targetMin: number;
  enabled: boolean;
};

export function SlaPoliciesPanel({
  boardId,
  initial,
}: {
  boardId: string;
  initial: Pol[];
}) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(target);
    if (!Number.isInteger(t) || t <= 0) {
      toast.error("target_min > 0");
      return;
    }
    start(async () => {
      try {
        const row = await createSlaPolicy({
          boardId,
          name,
          targetMin: t,
          appliesWhen: {},
        });
        setItems((curr) => [
          ...curr,
          {
            id: row.id,
            name: row.name,
            targetMin: row.targetMin,
            enabled: row.enabled,
          },
        ]);
        setName("");
        setTarget("");
        setAdding(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function del(id: string) {
    start(async () => {
      try {
        await deleteSlaPolicy({ id });
        setItems((c) => c.filter((p) => p.id !== id));
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function toggle(p: Pol) {
    start(async () => {
      try {
        const row = await updateSlaPolicy({ id: p.id, enabled: !p.enabled });
        setItems((c) =>
          c.map((x) => (x.id === p.id ? { ...x, enabled: row.enabled } : x)),
        );
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function scan() {
    start(async () => {
      try {
        const r = await scanBoardSla({ boardId });
        toast.success(
          `Scan done. ${r.breachedActive} active breach${
            r.breachedActive === 1 ? "" : "es"
          }.`,
        );
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">SLA policies</h3>
        <div className="flex gap-2">
          <Button size="xs" variant="outline" onClick={scan} disabled={pending}>
            <RotateCw className="size-3 mr-1" /> SCAN NOW
          </Button>
          {!adding && (
            <Button size="xs" onClick={() => setAdding(true)}>
              <Plus className="size-3 mr-1" /> POLICY
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={add} className="flex items-end gap-2 glass rounded-2xl p-3">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="sla-name">Name</Label>
            <Input
              id="sla-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5 w-32">
            <Label htmlFor="sla-target">Target (min)</Label>
            <Input
              id="sla-target"
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            ADD
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdding(false)}
          >
            ×
          </Button>
        </form>
      )}

      <ul className="divide-y divide-hairline glass rounded-2xl">
        {items.map((p) => (
          <li key={p.id} className="px-4 py-3 flex items-center gap-3">
            <span className="font-medium flex-1">{p.name}</span>
            <span className="mono-meta-sm text-fg-faint tabular-nums">
              {p.targetMin}m
            </span>
            <Button
              size="xs"
              variant={p.enabled ? "secondary" : "ghost"}
              onClick={() => toggle(p)}
              disabled={pending}
            >
              {p.enabled ? "ENABLED" : "DISABLED"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => del(p.id)}
              disabled={pending}
            >
              <Trash2 className="size-3" />
            </Button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-4 text-sm text-fg-faint italic">
            No SLAs yet.
          </li>
        )}
      </ul>
    </div>
  );
}
