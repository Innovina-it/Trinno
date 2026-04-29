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
      >
        <Plus className="size-3.5 text-signal mr-0.5" /> New board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg paper-grid">
          <DialogHeader>
            <div className="flex items-baseline justify-between gap-2">
              <DialogTitle>Create board.</DialogTitle>
              <span className="mono-meta-sm text-ink/40">FORM-NB</span>
            </div>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {/* Editorial preview — paper card with tint, hairline border */}
            <div
              className="relative flex h-32 items-end border border-ink p-3"
              style={{
                background: `linear-gradient(${color}1f, ${color}1f), var(--paper)`,
              }}
              aria-hidden
            >
              <div className="absolute inset-x-3 top-2 flex items-baseline justify-between">
                <span className="mono-meta-sm text-ink/45">PREVIEW</span>
                <span
                  aria-hidden
                  className="block h-1 w-8"
                  style={{ backgroundColor: color }}
                />
              </div>
              <span className="serif-display text-2xl text-ink leading-none">
                {title.trim() || "Board preview"}
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="board-title">Title</Label>
              <Input
                id="board-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={1}
                maxLength={120}
                placeholder="e.g. Roadmap"
              />
            </div>

            <div className="space-y-2">
              <Label>Background</Label>
              <div className="grid grid-cols-6 gap-px border border-ink/30 bg-ink/30">
                {PALETTE.map((c, i) => {
                  const selected = color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`relative flex aspect-square items-center justify-center bg-paper transition-colors duration-100 ${selected ? "ring-2 ring-inset ring-ink" : "hover:bg-paper-shadow"}`}
                      aria-label={`Pick ${c}`}
                      aria-pressed={selected}
                    >
                      <span
                        aria-hidden
                        className="block h-5 w-5"
                        style={{ backgroundColor: c }}
                      />
                      <span className="absolute top-0.5 left-1 mono-meta-sm text-ink/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {selected && (
                        <Check className="absolute bottom-1 right-1 size-3 text-signal" strokeWidth={3} />
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
