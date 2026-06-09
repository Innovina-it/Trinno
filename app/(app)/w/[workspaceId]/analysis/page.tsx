import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listRuns } from "@/lib/pma/registry";
import { getAnalysisGate } from "@/lib/pma/gate";
import { RunAnalysisPanel } from "@/components/pma/run-analysis-panel";
import type { PmaAnalysisRunRow } from "@/lib/db/schema";

// PMA U10 — Analysis tab. Lists past "Run analysis" runs (readable by any
// member) and offers the run control (owner/admin, gated). Each completed run
// links to its report Google Doc in the Output Drive folder.

// Run timestamps display in Europe/Rome wall-clock (the run label's timezone),
// dd/mm/yyyy HH:MM.
function formatRunTime(value: string | Date | null): string {
  if (value == null) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("en-GB", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

function RunRow({ run }: { run: PmaAnalysisRunRow }) {
  const ok = run.status === "success";
  const noChanges = run.status === "no_changes";
  const counts = run.counts ?? {};
  const summary = noChanges
    ? "Nessuna nuova modifica nel periodo selezionato"
    : ok
      ? `${counts.changed ?? 0} changed · ${counts.missed ?? 0} missed · ${counts.removed ?? 0} removed`
      : "Run failed — no report produced";

  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-hairline py-4">
      <div className="space-y-1">
        <div className="mono-meta-sm tabular-nums text-fg">
          {formatRunTime(run.runAt)}
        </div>
        <div className="mono-meta-sm text-fg-faint">{summary}</div>
      </div>
      {run.reportWebViewLink ? (
        <a
          href={run.reportWebViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mono-meta-sm shrink-0 text-[color:var(--accent-cyan)] hover:underline"
        >
          Open report ↗
        </a>
      ) : (
        <span className="mono-meta-sm shrink-0 text-fg-faint">
          {ok || noChanges ? "—" : "failed"}
        </span>
      )}
    </li>
  );
}

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();

  const [runs, gate] = await Promise.all([
    listRuns(workspaceId),
    getAnalysisGate(token, workspaceId, user.id),
  ]);

  const emptyHint = gate.canRun
    ? "Run one above to generate the first report."
    : gate.isOwnerAdmin
      ? "Set a Source and an Output Drive folder in settings, then run one."
      : "An owner or admin can run the first analysis.";

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 sm:px-4 md:px-6 md:py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">{ws.name.toUpperCase()} / ANALYSIS</span>
        <h1 className="serif-display text-5xl">Analysis</h1>
        <div className="flex items-end justify-between gap-3">
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
          <RunAnalysisPanel
            workspaceId={workspaceId}
            canRun={gate.canRun}
            isOwnerAdmin={gate.isOwnerAdmin}
            foldersConfigured={gate.foldersConfigured}
          />
        </div>
      </header>

      {runs.length === 0 ? (
        <p className="font-serif italic text-fg-faint">
          No analyses yet. {emptyHint}
        </p>
      ) : (
        <ol data-testid="pma-runs">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </ol>
      )}
    </div>
  );
}
