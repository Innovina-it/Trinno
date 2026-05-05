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
      { keys: "/", desc: "Focus search" },
      { keys: "Esc", desc: "Close dialog or overlay" },
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
