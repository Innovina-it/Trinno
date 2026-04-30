"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setWipLimit } from "@/actions/lists";
import { toast } from "sonner";

type ListLite = { id: string; title: string; wipLimit: number | null };

export function ListsAdminPanel({ lists }: { lists: ListLite[] }) {
  return (
    <ul className="divide-y divide-hairline glass rounded-2xl">
      {lists.map((l) => (
        <li key={l.id} className="px-4 py-3 flex items-center gap-3">
          <span className="serif-display text-lg flex-1">{l.title}</span>
          <WipSetter listId={l.id} initial={l.wipLimit ?? null} />
        </li>
      ))}
    </ul>
  );
}

function WipSetter({ listId, initial }: { listId: string; initial: number | null }) {
  const [v, setV] = useState<string>(initial?.toString() ?? "");
  const [pending, start] = useTransition();

  function save() {
    const num = v.trim() === "" ? null : Number(v);
    if (num !== null && (!Number.isInteger(num) || num <= 0 || num > 999)) {
      toast.error("1 to 999 (or empty to clear).");
      return;
    }
    start(async () => {
      try { await setWipLimit({ id: listId, wipLimit: num }); toast.success("Saved."); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="mono-meta-sm text-fg-faint">WIP</span>
      <Input
        value={v} onChange={(e) => setV(e.target.value)}
        type="number" min={1} max={999} placeholder="—"
        className="h-8 w-20 text-center"
      />
      <Button size="xs" onClick={save} disabled={pending}>SAVE</Button>
    </div>
  );
}
