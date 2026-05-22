"use client";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, X, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { errorBus, type ErrorEntry } from "@/lib/errors/error-bus";
import { errorCopy } from "@/lib/errors/copy";

/**
 * Plan #16b-γ-C (#6) — persistent error pane.
 *
 * Renders a fixed-position collapsible bar at the bottom of the
 * viewport. Stays out of the way when there are no errors (returns
 * null), drops in when one arrives, and stays there until manually
 * dismissed. Per-row Retry button calls the provided callback then
 * dismisses on success.
 */
export function ErrorPane() {
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    return errorBus.subscribe(setEntries);
  }, []);

  if (entries.length === 0) return null;

  const headline =
    entries.length === 1
      ? errorCopy(entries[0].code, entries[0].message).title
      : `${entries.length} unresolved errors`;

  function onRetry(entry: ErrorEntry) {
    if (!entry.retry) return;
    setBusyId(entry.id);
    start(async () => {
      try {
        await entry.retry?.();
        errorBus.dismiss(entry.id);
      } catch {
        // Leave the entry in the bus; the user can try again or dismiss.
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-3xl px-3 pb-3"
      role="alert"
      aria-live="polite"
      data-testid="error-pane"
    >
      <div className="rounded-xl border border-red-500/40 bg-red-950/95 text-red-50 shadow-xl">
        <div className="flex items-center gap-2 px-3 py-2">
          <AlertTriangle className="size-4 shrink-0 text-red-300" />
          <span className="flex-1 truncate text-sm">{headline}</span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            data-testid="error-pane-toggle"
            className="rounded p-1 text-red-200 hover:bg-red-900/60"
            aria-label={collapsed ? "Expand errors" : "Collapse errors"}
          >
            {collapsed ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => errorBus.clear()}
            data-testid="error-pane-clear-all"
            className="mono-meta-sm text-red-200 hover:text-red-50 px-1.5"
            title="Dismiss all"
          >
            CLEAR
          </button>
        </div>
        {!collapsed && (
          <ul className="border-t border-red-500/30 max-h-60 overflow-y-auto">
            {entries.map((e) => {
              const copy = errorCopy(e.code, e.message);
              return (
              <li
                key={e.id}
                className="flex items-center gap-2 px-3 py-2 border-b border-red-500/15 last:border-0"
                data-testid="error-pane-entry"
                data-error-id={e.id}
                data-error-code={e.code}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium break-words">
                    {copy.title}
                  </div>
                  {copy.description && (
                    <div
                      className="mono-meta-sm text-red-200/85 break-words"
                      data-testid="error-pane-description"
                    >
                      {copy.description}
                    </div>
                  )}
                </div>
                {e.retry && (
                  <button
                    type="button"
                    onClick={() => onRetry(e)}
                    disabled={busyId === e.id}
                    data-testid="error-pane-retry"
                    className="chip mono-meta-sm inline-flex items-center gap-1 bg-red-900/50 hover:bg-red-900/70 ring-1 ring-red-500/30"
                  >
                    <RefreshCw
                      className={`size-3 ${
                        busyId === e.id ? "animate-spin" : ""
                      }`}
                    />
                    RETRY
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => errorBus.dismiss(e.id)}
                  data-testid="error-pane-dismiss"
                  className="rounded p-1 text-red-200 hover:bg-red-900/60"
                  aria-label="Dismiss"
                >
                  <X className="size-3" />
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
