"use client";
import { toast } from "sonner";
import { BookOpen, Square, CheckSquare, Bug, Layers3 } from "lucide-react";

// Type is fixed at creation. Edit-mode access was removed (2026-05-14)
// because changing type after a card exists violates parent/subtask
// invariants enforced by the DB triggers and surfaced as opaque errors
// to the user. The chip below is display-only.
//
// Story kept here for visual resolution of legacy cards — TypeIcon still
// maps type='story' to BookOpen so historical data stays readable.
const TYPES = [
  { id: "story",   label: "Story",    Icon: BookOpen     },
  { id: "task",    label: "Task",     Icon: Square       },
  { id: "subtask", label: "Subtask",  Icon: CheckSquare  },
  { id: "bug",     label: "Bug",      Icon: Bug          },
] as const;
const LEGACY_SUBBOARD_TYPE = {
  id: "legacy-subboard",
  label: "Sub-board",
  Icon: Layers3,
} as const;

export type CardType = typeof TYPES[number]["id"];

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  // 'task' is the default type for most cards; the hollow Square glyph
  // reads as a clickable checkbox, not a type marker.  Drop the icon
  // for that path — absence of an icon == "task" by convention.  Other
  // types keep their distinctive glyphs.
  if (type === "task") return null;
  const t = TYPES.find((x) => x.id === type) ?? LEGACY_SUBBOARD_TYPE;
  return <t.Icon className={className ?? "size-3.5"} aria-label={t.label} />;
}

export function TypePicker({ type }: { cardId?: string; type: string; parentCardId?: string | null }) {
  const current = TYPES.find((x) => x.id === type) ?? LEGACY_SUBBOARD_TYPE;
  const rejectTypeChange = () => {
    toast.error("Type is fixed at creation");
  };
  return (
    <button
      type="button"
      className="chip pointer-events-none inline-flex items-center gap-1.5 cursor-default"
      title="Type is fixed at creation"
      aria-disabled="true"
      aria-label={`Type: ${current.label}`}
      disabled
      onClick={rejectTypeChange}
      data-testid="card-type-locked"
    >
      <current.Icon className="size-3.5" />
      <span>{current.label.toUpperCase()}</span>
    </button>
  );
}
