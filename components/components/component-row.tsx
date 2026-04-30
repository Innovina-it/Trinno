"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { updateComponent, deleteComponent } from "@/actions/components";
import { toast } from "sonner";

export function ComponentRow({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [current, setCurrent] = useState(name);
  const [pending, start] = useTransition();

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === current) {
      setEditing(false);
      setDraft(current);
      return;
    }
    start(async () => {
      try {
        const r = await updateComponent({ id, name: trimmed });
        setCurrent(r.name);
        setEditing(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function del() {
    if (!confirm("Delete this component?")) return;
    start(async () => {
      try {
        await deleteComponent({ id });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <li
      className="px-4 py-3 flex items-center gap-3"
      data-component-id={id}
    >
      {editing ? (
        <>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={60}
            className="flex-1"
            autoFocus
          />
          <Button
            size="xs"
            onClick={save}
            disabled={pending}
            aria-label="Save"
          >
            <Check className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(current);
            }}
            aria-label="Cancel"
          >
            <X className="size-3" />
          </Button>
        </>
      ) : (
        <>
          <span className="font-medium flex-1">{current}</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label="Rename"
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={del}
            disabled={pending}
            aria-label="Delete"
          >
            <Trash2 className="size-3" />
          </Button>
        </>
      )}
    </li>
  );
}
