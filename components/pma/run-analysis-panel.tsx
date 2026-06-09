"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

// PMA U10 — the "Run analysis" control. Owner/admin only, disabled until both
// Drive folders are configured (the route enforces the same; this is the
// affordance + the reason). A run makes a real Gemini Pro pass so it can take
// tens of seconds — the button reports progress and refreshes the server list
// on success.
export function RunAnalysisPanel({
  workspaceId,
  canRun,
  isOwnerAdmin,
  foldersConfigured,
}: {
  workspaceId: string;
  canRun: boolean;
  isOwnerAdmin: boolean;
  foldersConfigured: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const disabledReason = !isOwnerAdmin
    ? "Owner or admin only"
    : !foldersConfigured
      ? "Set a Source and an Output Drive folder in settings first"
      : null;

  const busy = running || refreshing;

  async function run() {
    setError(null);
    setNotice(null);
    setRunning(true);
    try {
      const res = await fetch("/api/pma/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { result?: { status?: string }; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "The analysis could not be completed.");
        return;
      }
      // U12.5 — an empty-window run produces no report; tell the user inline
      // (the run still appears in history with the same notice).
      if (json?.result?.status === "no_changes") {
        setNotice("Nessuna nuova modifica nel periodo selezionato.");
      }
      startRefresh(() => router.refresh());
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        size="sm"
        onClick={run}
        disabled={!canRun || busy}
        title={disabledReason ?? undefined}
        data-testid="pma-run"
      >
        {running ? "Running…" : refreshing ? "Loading…" : "Run analysis"}
      </Button>
      {disabledReason && (
        <span className="mono-meta-sm text-fg-faint">{disabledReason}</span>
      )}
      {error && (
        <span className="mono-meta-sm text-red-400" role="alert">
          {error}
        </span>
      )}
      {notice && !error && (
        <span className="mono-meta-sm text-fg-faint" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
