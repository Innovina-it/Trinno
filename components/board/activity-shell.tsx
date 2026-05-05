"use client";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

const STORAGE_KEY = "trinno:activity-open";

export function ActivityShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v !== null) setOpen(v === "1");
    } catch {}
    setHydrated(true);
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  if (!hydrated) {
    // Render collapsed pill on the server to match the new default;
    // localStorage may flip to open after hydration.
    return (
      <button
        type="button"
        className="glass rounded-2xl px-3 py-2.5 self-start flex items-center gap-2 text-fg-muted opacity-70"
        aria-hidden
        tabIndex={-1}
      >
        <ChevronRight className="size-4 rotate-180" />
        <span className="mono-meta-sm">ACTIVITY</span>
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="glass rounded-2xl px-3 py-2.5 self-start flex items-center gap-2 text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors duration-150"
        aria-label="Show activity"
        title="Show activity"
      >
        <ChevronRight className="size-4 rotate-180" />
        <span className="mono-meta-sm">ACTIVITY</span>
      </button>
    );
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        className="absolute top-2.5 right-12 z-10 mono-meta-sm text-fg-faint hover:text-fg transition-colors"
        aria-label="Hide activity"
        title="Hide activity"
      >
        HIDE
      </button>
      {children}
    </div>
  );
}
