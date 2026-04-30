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

// Studio-plastic palette: jewel tones + signature accents
const PALETTE = ["#00e5ff", "#8b5cf6", "#ff2bd6", "#c3f73a", "#ffb020", "#ff6b6b"];

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const num = parseInt(m, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
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

  const [r, g, b] = hexToRgb(color);
  const previewBg = `linear-gradient(135deg, rgb(${r} ${g} ${b} / 0.45) 0%, rgb(${r} ${g} ${b} / 0.12) 70%, rgb(255 255 255 / 0.04) 100%)`;
  const previewGlow = `0 1px 0 0 rgb(255 255 255 / 0.12) inset, 0 24px 50px -12px rgb(${r} ${g} ${b} / 0.45)`;

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
      >
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
            {/* Live preview tile — mirrors the actual board grid card aesthetic */}
            <div
              className="relative flex h-36 items-end overflow-hidden rounded-2xl border border-[color:var(--hairline)] p-4 backdrop-blur-xl"
              style={{ background: previewBg, boxShadow: previewGlow }}
              aria-hidden
            >
              <div className="absolute inset-x-4 top-3 flex items-baseline justify-between">
                <span className="mono-meta-sm text-fg-faint">PREVIEW</span>
                <span
                  className="block size-3 rounded-full"
                  style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }}
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
              <Label>Background</Label>
              <div className="grid grid-cols-6 gap-2">
                {PALETTE.map((c, i) => {
                  const selected = color === c;
                  const [pr, pg, pb] = hexToRgb(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`group/swatch relative flex aspect-square items-center justify-center rounded-2xl border transition-all duration-200 ${
                        selected
                          ? "border-[color:var(--hairline-hi)] scale-105"
                          : "border-[color:var(--hairline)] hover:scale-105 hover:border-[color:var(--hairline-hi)]"
                      }`}
                      style={{
                        background: `radial-gradient(circle at 30% 30%, rgb(${pr} ${pg} ${pb} / 0.7), rgb(${pr} ${pg} ${pb} / 0.18))`,
                        boxShadow: selected
                          ? `0 0 0 2px rgb(${pr} ${pg} ${pb} / 0.6), 0 12px 24px -8px rgb(${pr} ${pg} ${pb} / 0.5)`
                          : undefined,
                      }}
                      aria-label={`Pick ${c}`}
                      aria-pressed={selected}
                    >
                      <span className="absolute top-1 left-1.5 mono-meta-sm text-white/60">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {selected && (
                        <Check className="absolute bottom-1.5 right-1.5 size-3.5 text-white drop-shadow" strokeWidth={3} />
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
