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

// Monochrome palette: shades of grey only. Picker still functional but no chroma.
const PALETTE = [
  "#fafafa",
  "#d4d4d4",
  "#a3a3a3",
  "#737373",
  "#404040",
  "#171717",
];

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
        <Plus className="size-3.5 mr-0.5" /> New board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-baseline justify-between gap-2">
              <DialogTitle>New board.</DialogTitle>
              <span className="chip">FORM-NB</span>
            </div>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {/* Live preview tile — neutral mono surface */}
            <div
              className="glass relative flex h-36 items-end overflow-hidden rounded-2xl p-4"
              aria-hidden
            >
              <div className="absolute inset-x-4 top-3 flex items-baseline justify-between">
                <span className="mono-meta-sm text-fg-faint">PREVIEW</span>
                <span
                  className="block size-3 rounded-full border border-hairline-hi"
                  style={{ backgroundColor: color }}
                />
              </div>
              <span className="serif-display text-2xl text-fg leading-none">
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

            <div className="space-y-3">
              <Label>Tone</Label>
              <div className="grid grid-cols-6 gap-2">
                {PALETTE.map((c, i) => {
                  const selected = color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`group/swatch relative flex aspect-square items-center justify-center rounded-xl border transition-all duration-150 ${
                        selected
                          ? "border-fg/70 scale-105"
                          : "border-hairline hover:border-hairline-hi"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Pick ${c}`}
                      aria-pressed={selected}
                    >
                      <span className="absolute top-1 left-1.5 mono-meta-sm text-black/60 mix-blend-difference">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {selected && (
                        <Check
                          className="absolute bottom-1 right-1 size-3.5 mix-blend-difference text-white"
                          strokeWidth={3}
                        />
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
