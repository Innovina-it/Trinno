"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Group = { name: string; rows: Array<{ keys: string; desc: string }> };

const GROUPS: Group[] = [
  {
    name: "Global",
    rows: [
      { keys: "?", desc: "Show this overlay" },
      { keys: "Cmd / Ctrl + K", desc: "Open command palette" },
      { keys: "/", desc: "Open command palette (search)" },
      { keys: "Esc", desc: "Close dialog or overlay" },
    ],
  },
  {
    name: "Navigation",
    rows: [
      { keys: "g r", desc: "Go to roadmap" },
      { keys: "g b", desc: "Go to boards" },
      { keys: "g l", desc: "Go to backlog" },
      { keys: "g t", desc: "Go to my tasks" },
      { keys: "g i", desc: "Go to inbox" },
      { keys: "g d", desc: "Go to dashboards" },
      { keys: "g w", desc: "Go to workload" },
    ],
  },
  {
    name: "Inbox",
    rows: [
      { keys: "j / ↓", desc: "Next" },
      { keys: "k / ↑", desc: "Previous" },
      { keys: "Enter", desc: "Open" },
      { keys: "e", desc: "Mark active read" },
      { keys: "Shift + E", desc: "Mark all read" },
    ],
  },
  {
    name: "Card modal",
    rows: [
      { keys: "[", desc: "Previous sibling card" },
      { keys: "]", desc: "Next sibling card" },
      { keys: "Cmd / Ctrl + Enter", desc: "Send comment, save notes" },
    ],
  },
  {
    name: "Roadmap",
    rows: [
      { keys: "z / x", desc: "Zoom out / in" },
      { keys: "Drag bar", desc: "Reschedule" },
      { keys: "Drag edges", desc: "Resize start or target" },
    ],
  },
];

// Roadmap bar pattern legend. Mirrors the documented status textures in
// DESIGN.md so the operator can decode bars without leaving the page.
const ROADMAP_BAR_LEGEND: Array<{
  label: string;
  pattern: React.CSSProperties;
  desc: string;
}> = [
  {
    label: "Todo",
    pattern: {
      background: "color-mix(in oklab, var(--status-todo) 22%, transparent)",
    },
    desc: "Untriaged. Solid fill.",
  },
  {
    label: "In progress",
    pattern: {
      background: "color-mix(in oklab, var(--status-in-progress) 38%, transparent)",
      boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--status-in-progress) 55%, transparent)",
    },
    desc: "Pulses. Reduced-motion safe.",
  },
  {
    label: "Review",
    pattern: {
      background: "color-mix(in oklab, var(--status-review) 22%, transparent)",
      backgroundImage:
        "repeating-linear-gradient(45deg, color-mix(in oklab, var(--status-review) 45%, transparent) 0 4px, transparent 4px 8px)",
    },
    desc: "Diagonal stripes. Waiting on a human.",
  },
  {
    label: "Done",
    pattern: {
      background: "color-mix(in oklab, var(--status-done) 22%, transparent)",
      backgroundImage:
        "repeating-linear-gradient(0deg, color-mix(in oklab, var(--status-done) 50%, transparent) 0 2px, transparent 2px 6px)",
    },
    desc: "Horizontal hatches. Closed and frozen.",
  },
  {
    label: "Blocked",
    pattern: {
      background: "color-mix(in oklab, var(--status-blocked) 12%, transparent)",
      boxShadow: "inset 0 0 0 2px color-mix(in oklab, var(--status-blocked) 60%, transparent)",
    },
    desc: "Inset ring. Fenced off, needs a decision.",
  },
];

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <section key={g.name} className="space-y-1.5">
              <h3 className="mono-meta-sm text-fg-faint">
                {g.name.toUpperCase()}
              </h3>
              <dl className="rounded-md border border-hairline bg-[color:var(--surface)] divide-y divide-hairline overflow-hidden">
                {g.rows.map((r) => (
                  <div
                    key={r.keys}
                    className="grid grid-cols-[10rem_1fr] gap-3 px-3 py-2 items-center"
                  >
                    <dt className="mono-meta-sm tabular-nums text-fg">
                      {r.keys}
                    </dt>
                    <dd className="text-sm text-fg-muted">{r.desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section className="space-y-1.5" data-testid="roadmap-bar-legend">
            <h3 className="mono-meta-sm text-fg-faint">
              ROADMAP BAR PATTERNS
            </h3>
            <dl className="rounded-md border border-hairline bg-[color:var(--surface)] divide-y divide-hairline overflow-hidden">
              {ROADMAP_BAR_LEGEND.map((r) => (
                <div
                  key={r.label}
                  className="grid grid-cols-[3.5rem_5rem_1fr] gap-3 px-3 py-2 items-center"
                >
                  <span
                    aria-hidden
                    className="h-5 w-full rounded-md border border-hairline-hi"
                    style={r.pattern}
                  />
                  <dt className="mono-meta-sm tabular-nums text-fg">
                    {r.label.toUpperCase()}
                  </dt>
                  <dd className="text-sm text-fg-muted">{r.desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
