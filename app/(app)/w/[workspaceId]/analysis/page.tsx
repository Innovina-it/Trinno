import Link from "next/link";
import { notFound } from "next/navigation";

import { and, eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { dbAsUser } from "@/lib/db/client";
import { links, cards, boards, pmaWorkspaceState } from "@/lib/db/schema";
import { listRuns } from "@/lib/pma/registry";
import { getAnalysisGate } from "@/lib/pma/gate";
import { listContributorOrgs } from "@/lib/pma/contributor-orgs-store";
import {
  ALL_SECTIONS_ON,
  sanitizeReportSections,
} from "@/lib/pma/report-sections";
import { RunAnalysisPanel } from "@/components/pma/run-analysis-panel";
import { ReportSectionsProvider } from "@/components/pma/report-sections-context";
import { ReportSectionsFieldset } from "@/components/pma/report-sections-fieldset";
import { ReportSettingsControls } from "@/components/pma/report-settings-controls";
import {
  sanitizeReportLength,
  sanitizeCustomPrompt,
} from "@/lib/pma/report-settings";
import { ContributorOrgsSection } from "@/components/pma/contributor-orgs-section";
import { AnalysisFolderControl } from "@/components/pma/analysis-folder-control";
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

// U12.13 — the run's REQUESTED period, dd/mm/yyyy (UTC, no time). Null bounds
// (a whole-document run) render as "whole document".
function formatPeriod(
  start: string | Date | null,
  end: string | Date | null,
): string {
  const day = (v: string | Date | null): string | null => {
    if (v == null) return null;
    const d = typeof v === "string" ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };
  const s = day(start);
  const e = day(end);
  return s && e ? `${s} – ${e}` : "whole document";
}

function RunRow({ run }: { run: PmaAnalysisRunRow }) {
  const ok = run.status === "success";
  const noChanges = run.status === "no_changes";
  const emptyPeriod = run.status === "empty_period";
  const counts = run.counts ?? {};
  const fileN = counts.changed ?? 0;
  // #5b — "6 deliverables · 18 files": prefix the deliverable count when it
  // collapses copies (D < N). missed/removed are noise at 0, so they show ONLY
  // when non-zero — a real read failure / deletion still surfaces.
  const deliverableN = counts.deliverables;
  const summary = emptyPeriod
    ? "No documents in the selected period"
    : noChanges
      ? "No new changes in the selected period"
      : ok
        ? [
            deliverableN != null && deliverableN < fileN
              ? `${deliverableN} deliverable${deliverableN === 1 ? "" : "s"}`
              : null,
            `${fileN} ${fileN === 1 ? "file" : "files"}`,
            counts.missed ? `${counts.missed} missed` : null,
            counts.removed ? `${counts.removed} removed` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Run failed — no report produced";

  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-hairline py-4">
      <div className="space-y-1">
        <div className="mono-meta-sm tabular-nums text-fg">
          {formatRunTime(run.runAt)} · {formatPeriod(run.windowStart, run.windowEnd)}
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
          {ok || noChanges || emptyPeriod ? "—" : "failed"}
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

  // The workspace's current Documents folder link (source), so an owner/admin can
  // (re)configure it inline. Best-effort: any RLS/transient failure → null.
  const sourceRow = await dbAsUser(token, (tx) =>
    tx
      .select({ url: links.url })
      .from(links)
      .where(
        and(
          eq(links.workspaceId, workspaceId),
          eq(links.scope, "workspace"),
          eq(links.purpose, "source"),
        ),
      )
      .limit(1),
  )
    .then((r) => r[0] ?? null)
    .catch(() => null);

  // The saved report-section combination, so the panel's checkboxes open the way
  // they were last left for this workspace. Absent row/column → all sections on.
  // Best-effort: any RLS/transient failure → default (all on).
  const savedState = await dbAsUser(token, (tx) =>
    tx
      .select({
        reportSections: pmaWorkspaceState.reportSections,
        reportLength: pmaWorkspaceState.reportLength,
        customPrompt: pmaWorkspaceState.customPrompt,
      })
      .from(pmaWorkspaceState)
      .where(eq(pmaWorkspaceState.workspaceId, workspaceId))
      .limit(1),
  )
    .then((r) => r[0] ?? null)
    .catch(() => null);
  const initialSections = {
    ...ALL_SECTIONS_ON,
    ...sanitizeReportSections(savedState?.reportSections ?? null),
  };
  // 0143 — saved length + custom focus so the panel opens the way it was left.
  const initialReportLength = sanitizeReportLength(savedState?.reportLength);
  const initialCustomPrompt = sanitizeCustomPrompt(savedState?.customPrompt) ?? "";

  // Contributor → organization mapping (workspace OWNER only), moved here from
  // workspace settings: it shapes the report, so it belongs with the run config.
  // orgHints are org names already in the roadmap (the repeated "· Partner"
  // suffix the plan import stamps on cards), offered as autocomplete; the ≥2
  // filter drops stray one-off "·" task fragments. Fetched only for the owner.
  let contributorOrgRows: Awaited<ReturnType<typeof listContributorOrgs>> = [];
  let orgHints: string[] = [];
  if (gate.isOwner) {
    [contributorOrgRows, orgHints] = await Promise.all([
      listContributorOrgs(token, workspaceId).catch(() => []),
      dbAsUser(token, async (tx) => {
        const rows = await tx
          .select({ title: cards.title })
          .from(cards)
          .innerJoin(boards, eq(cards.boardId, boards.id))
          .where(eq(boards.workspaceId, workspaceId));
        const counts = new Map<string, number>();
        for (const r of rows) {
          const parts = r.title.split(" · ");
          if (parts.length < 2) continue;
          const owner = parts[parts.length - 1].trim();
          if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
        return Array.from(counts.entries())
          .filter(([, n]) => n >= 2)
          .map(([owner]) => owner);
      }).catch(() => [] as string[]),
    ]);
  }

  const emptyHint = gate.canRun
    ? "Run one above to generate the first report."
    : gate.isOwnerAdmin
      ? "Set a Source and an Output Drive folder in settings, then run one."
      : "An owner or admin can run the first analysis.";

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 sm:px-4 md:px-6 md:py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <ReportSectionsProvider
          initialSections={initialSections}
          initialReportLength={initialReportLength}
          initialCustomPrompt={initialCustomPrompt}
        >
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
          {gate.isOwnerAdmin && (
            <div className="space-y-3 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
                <span className="mono-meta-sm shrink-0 pt-1.5 tracking-[0.14em] text-fg-faint">
                  Source
                </span>
                <div className="min-w-0 flex-1">
                  <AnalysisFolderControl
                    bare
                    workspaceId={workspaceId}
                    currentFolderUrl={sourceRow?.url ?? null}
                  />
                </div>
              </div>
              <div className="h-px bg-[color:var(--hairline)]" aria-hidden />
              <ReportSectionsFieldset canRun={gate.canRun} />
              <div className="h-px bg-[color:var(--hairline)]" aria-hidden />
              <ReportSettingsControls canRun={gate.canRun} />
              {gate.isOwner && (
                <>
                  <div className="h-px bg-[color:var(--hairline)]" aria-hidden />
                  <ContributorOrgsSection
                    workspaceId={workspaceId}
                    initialRows={contributorOrgRows}
                    canEdit={gate.isOwner}
                    orgHints={orgHints}
                  />
                </>
              )}
            </div>
          )}
        </ReportSectionsProvider>
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
