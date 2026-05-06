"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { setWipLimit, setListStatusKind } from "@/actions/lists";
import { toast } from "sonner";

type StatusKind = "todo" | "in_progress" | "review" | "done" | "blocked";

type ListLite = {
  id: string;
  title: string;
  wipLimit: number | null;
  statusKind: StatusKind | null;
};

const STATUS_OPTIONS: { value: StatusKind | ""; label: string }[] = [
  { value: "", label: "unmapped" },
  { value: "todo", label: "to do" },
  { value: "in_progress", label: "in progress" },
  { value: "review", label: "review" },
  { value: "done", label: "done" },
  { value: "blocked", label: "blocked" },
];

export function ListsAdminPanel({ lists }: { lists: ListLite[] }) {
  return (
    <ul className="divide-y divide-hairline glass rounded-2xl">
      {lists.map((l) => (
        <li key={l.id} className="px-4 py-3 flex items-center gap-3">
          <span className="serif-display text-lg flex-1">{l.title}</span>
          <StatusSetter listId={l.id} initial={l.statusKind} />
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

function StatusSetter({
  listId,
  initial,
}: {
  listId: string;
  initial: StatusKind | null;
}) {
  const [v, setV] = useState<StatusKind | "">(initial ?? "");
  const [pending, start] = useTransition();

  function onChange(next: string) {
    const nextKind = (next === "" ? null : (next as StatusKind));
    setV(next as StatusKind | "");
    start(async () => {
      try {
        await setListStatusKind({ id: listId, statusKind: nextKind });
      } catch (err) {
        toast.error((err as Error).message);
        // revert
        setV(initial ?? "");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="mono-meta-sm text-fg-faint">STATUS</span>
      <Select
        value={v}
        onValueChange={onChange}
        disabled={pending}
        aria-label="List status mapping"
        data-testid="list-status-select"
        options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        size="sm"
        className="w-36"
      />
    </div>
  );
}
