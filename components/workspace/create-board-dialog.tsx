"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createBoard } from "@/actions/boards";
import { Plus } from "lucide-react";

const PALETTE = ["#0079bf", "#d29034", "#519839", "#b04632", "#89609e", "#cd5a91"];

export function CreateBoardButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const b = await createBoard({
          workspaceId, title,
          backgroundKind: "color", backgroundValue: color,
        });
        setOpen(false); setTitle("");
        router.push(`/b/${b.id}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4 mr-1" /> New board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create board</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="board-title">Title</Label>
              <Input id="board-title" value={title}
                     onChange={(e) => setTitle(e.target.value)}
                     required minLength={1} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>Background</Label>
              <div className="flex gap-2">
                {PALETTE.map(c => (
                  <button key={c} type="button"
                    onClick={() => setColor(c)}
                    className={`size-8 rounded ${color === c ? "ring-2 ring-foreground" : ""}`}
                    style={{ background: c }}
                    aria-label={`Pick ${c}`} />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Creating…" : "Create board"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
