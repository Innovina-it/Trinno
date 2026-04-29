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
import { Plus, Check } from "lucide-react";

const PALETTE = ["#0079bf", "#d29034", "#519839", "#b04632", "#89609e", "#cd5a91"];

function swatchBackground(color: string): string {
  return `radial-gradient(circle at 0% 0%, rgba(255,255,255,0.3), transparent 55%), radial-gradient(circle at 100% 100%, rgba(0,0,0,0.18), transparent 55%), ${color}`;
}

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
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
      >
        <Plus className="size-4 mr-1" /> New board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create board</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {/* Visual preview */}
            <div
              className="aspect-[3/2] w-full overflow-hidden rounded-xl p-3 text-white font-semibold tracking-tight shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out"
              style={{ background: swatchBackground(color) }}
              aria-hidden
            >
              <span className="drop-shadow-sm">{title.trim() || "Board preview"}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="board-title">Title</Label>
              <Input id="board-title" value={title}
                     onChange={(e) => setTitle(e.target.value)}
                     required minLength={1} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>Background</Label>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map(c => {
                  const selected = color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`relative size-9 rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${selected ? "ring-2 ring-foreground" : ""}`}
                      style={{ background: swatchBackground(c) }}
                      aria-label={`Pick ${c}`}
                      aria-pressed={selected}
                    >
                      {selected && (
                        <Check className="absolute inset-0 m-auto size-4 text-white drop-shadow" strokeWidth={3} />
                      )}
                    </button>
                  );
                })}
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
