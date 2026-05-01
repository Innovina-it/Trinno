"use client";
import { useEffect, useState, useTransition } from "react";
import { Undo2, X } from "lucide-react";
import { undoBus, type UndoEntry } from "@/lib/undo-bus";

/**
 * Plan #16b-γ-D (#10) — undo banner.
 *
 * Subscribes to the in-memory undo bus and renders a single
 * bottom-center toast with Undo + dismiss. Auto-clears after the bus
 * timer (~8s) elapses; clicking Undo invokes the entry's callback.
 *
 * Mounted from app/(app)/layout.tsx so every authed page can show it.
 */
export function UndoBanner() {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => undoBus.subscribe(setEntry), []);

  if (!entry) return null;

  function onUndo() {
    start(async () => {
      await undoBus.invoke();
    });
  }

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-sm justify-center px-3 pointer-events-none"
      role="status"
      aria-live="polite"
      data-testid="undo-banner"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[color:var(--hairline-hi)] bg-[color:var(--surface-strong)] backdrop-blur-md px-4 py-2 text-sm text-fg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
        <span className="truncate max-w-[18rem]">{entry.message}</span>
        <button
          type="button"
          onClick={onUndo}
          disabled={pending}
          data-testid="undo-banner-undo"
          className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)]"
        >
          <Undo2 className="size-3" />
          UNDO
        </button>
        <button
          type="button"
          onClick={() => undoBus.dismiss()}
          aria-label="Dismiss"
          className="rounded p-1 text-fg-muted hover:bg-[rgb(255_255_255/0.08)] hover:text-fg"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
