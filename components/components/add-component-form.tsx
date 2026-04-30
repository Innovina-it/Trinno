"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { createComponent } from "@/actions/components";
import { toast } from "sonner";

export function AddComponentForm({ boardId }: { boardId: string }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      try {
        await createComponent({ boardId, name: trimmed });
        setName("");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="space-y-1.5 flex-1">
        <Label htmlFor="new-component">New component</Label>
        <Input
          id="new-component"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. auth, billing, ui-shell"
          maxLength={60}
        />
      </div>
      <Button type="submit" disabled={pending || !name.trim()}>
        <Plus className="size-3.5 mr-0.5" /> ADD
      </Button>
    </form>
  );
}
