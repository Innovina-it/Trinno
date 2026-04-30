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
import { createBoardFromTemplate } from "@/actions/boards";
import { Plus, Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  BOARD_TEMPLATES,
  type BoardTemplateId,
} from "@/lib/board-templates";

// Monochrome palette: shades of grey only. Picker still functional but no chroma.
const PALETTE = [
  "#fafafa",
  "#d4d4d4",
  "#a3a3a3",
  "#737373",
  "#404040",
  "#171717",
];

type Step = "template" | "details";

export function CreateBoardButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("template");
  const [templateId, setTemplateId] = useState<BoardTemplateId>("blank");
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [pending, start] = useTransition();
  const router = useRouter();

  function reset() {
    setStep("template");
    setTemplateId("blank");
    setTitle("");
    setColor(PALETTE[0]);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const { board } = await createBoardFromTemplate({
          workspaceId,
          title,
          backgroundKind: "color",
          backgroundValue: color,
          templateId,
        });
        setOpen(false);
        reset();
        router.push(`/b/${board.id}`);
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
        data-tour-target="new-board"
      >
        <Plus className="size-3.5 mr-0.5" /> New board
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-baseline justify-between gap-2">
              <DialogTitle>
                {step === "template" ? "Pick a template." : "New board."}
              </DialogTitle>
              <span className="chip">
                {step === "template" ? "STEP 1/2" : "STEP 2/2"}
              </span>
            </div>
          </DialogHeader>

          {step === "template" ? (
            <div className="space-y-5">
              <div
                role="radiogroup"
                aria-label="Board template"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                {BOARD_TEMPLATES.map((t) => {
                  const selected = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-template-id={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={`group/tpl glass relative flex flex-col gap-1.5 rounded-2xl p-4 text-left transition-all duration-150 ${
                        selected
                          ? "border-fg/70 ring-1 ring-fg/40"
                          : "border-hairline hover:border-hairline-hi"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="serif-display text-lg text-fg leading-tight">
                          {t.name}
                        </span>
                        {selected && (
                          <Check
                            className="size-4 text-fg"
                            strokeWidth={2.5}
                          />
                        )}
                      </div>
                      <p className="mono-meta-sm text-fg-muted leading-relaxed">
                        {t.description}
                      </p>
                      <div className="mono-meta-sm text-fg-faint pt-1">
                        {t.lists.length === 0
                          ? "No lists"
                          : `${t.lists.length} list${t.lists.length === 1 ? "" : "s"}`}
                        {t.labels.length > 0 && (
                          <span> &middot; {t.labels.length} labels</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => setStep("details")}
                >
                  <span>Continue</span>
                  <ChevronRight className="size-4" />
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {/* Live preview tile — neutral mono surface */}
              <div
                className="glass relative flex h-36 items-end overflow-hidden rounded-2xl p-4"
                aria-hidden
              >
                <div className="absolute inset-x-4 top-3 flex items-baseline justify-between">
                  <span className="mono-meta-sm text-fg-faint">
                    {BOARD_TEMPLATES.find((t) => t.id === templateId)?.name?.toUpperCase() ?? "PREVIEW"}
                  </span>
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
                  autoFocus
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("template")}
                  disabled={pending}
                >
                  <ChevronLeft className="size-4" />
                  <span>Back</span>
                </Button>
                <Button type="submit" disabled={pending || !title.trim()}>
                  {pending ? "Creating…" : "Create board"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
