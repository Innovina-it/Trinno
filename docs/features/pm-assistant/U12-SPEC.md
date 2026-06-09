# PMA U12 — Change-set spec (date-window + recap→DB + attribution + no-change notice)

Status: **SPEC / Gate 1 (awaiting approval)** · no code yet
Date: 2026-06-09
Tier: **3** (touches a migration + changes load-bearing detect semantics + design-invariant inversion). Full gates.
Supersedes/edits invariants in [DESIGN.md](DESIGN.md) §3 (detect model), §4.2/§4.3 (recap storage).

## Core spec

| | |
|---|---|
| **Goal** | Four PMA changes: (1) a run that finds nothing changed in the period must NOT create a report Doc — instead surface a "no new changes" notice; (2) the Analysis run takes an explicit **start/end date window** (`DateRangePopover`, default end=today, start=today−7d) and the report covers **only that period**; (3) per-file recap JSON stops being written to Drive and is stored in **Postgres** instead; (4) each reported change is **attributed by name** to whoever made it, "non noto" when unknown. |
| **Done looks like** | Owner/admin opens Analysis, sees a date-range control next to **Run analysis** defaulted to last-week→today, presses Run. The report (a) only discusses work in the chosen window, (b) tags changes with the author's name (or "non noto"), and (c) is produced **only if** something changed in that window — otherwise the page shows "Nessuna nuova modifica nel periodo selezionato" and no Doc is created. Recap JSON is in Postgres, not in the Drive `recaps/` folder. The `analyses/` report Docs still live in Drive. |
| **Must not change** | Output Doc reports stay native Google Docs in the Drive `analyses/` folder. trinno still only **writes** the Output folder, never the Source. Service-account/Gemini secrets stay server-only. Run stays owner/admin-gated; RLS on PMA tables stays workspace-scoped (recap_json readable by members, written service-role only). Roadmap/baseline/deviation grounding (`compareToBaseline`) unchanged. Existing run-history list keeps working. |

---

## Units

### U12.1 — Recap JSON → Postgres (migration)  ⟶ riskiest, do first
- **Goal:** stop `writeRecap()` writing `recaps/*.json` to Drive; persist the structured recap in Postgres.
- **Change:**
  - Migration **0132**: `alter table pma_file_registry add column recap_json jsonb;` (additive, nullable, reversible). `recap_file_id` kept but deprecated (no longer written).
  - [analyze.ts](../../../lib/pma/analyze.ts): drop the `writeRecap(...)` call; return `recap` in-memory as today (already does). `recapFileId` → null.
  - [reconcile.ts](../../../lib/pma/reconcile.ts): when upserting a registry row for an analyzed file, write `recap_json` = the structured recap. (reconcile already owns registry writes — keeps analyze's "never writes registry" boundary intact.)
  - [output.ts](../../../lib/pma/output.ts): remove `writeRecap` + `RECAPS_FOLDER` (or leave dead-stripped). Keep `createReport`/`ensureSubfolder` for `analyses/`.
  - schema.ts: add `recapJson` to `pmaFileRegistry`; registry mappers carry it.
- **Done:** a run writes no `recaps/` file to Drive; `pma_file_registry.recap_json` holds the latest recap per file.
- **Must not change:** `analyses/` Docs still on Drive; analyze still never writes the registry directly.

### U12.2 — Date-window detection  ⟶ biggest behavioral change
- **Goal:** the run analyzes only what changed inside `[start,end]`, and the report is scoped to that period.
- **Change:**
  - [run route](../../../app/api/pma/run/route.ts): accept `{ startDate, endDate }` (ISO dates); validate start ≤ end; default end=today, start=today−7d if absent.
  - [detect.ts](../../../lib/pma/detect.ts): add a **windowed mode** — list Source folder, keep files whose change activity falls in `[start,end]` (by `modifiedTime`, refined by revisions in U12.4). In windowed mode the Drive **page-token / Changes-API incremental path is bypassed** (the window is the scope, not "since last run"). `pma_workspace_state` page-token left in place but unused by this path.
  - **Version gate:** in windowed mode the gate is **bypassed** so re-selecting a period always re-reports it (user: "se indico gennaio parlo solo di gennaio"). [analyze.ts](../../../lib/pma/analyze.ts) gate becomes conditional on mode.
  - [synthesize.ts](../../../lib/pma/synthesize.ts): pass the window into the prompt/`runLabel` so the model frames the report to that period; Doc title includes the range.
- **Done:** picking Jan 1–Jan 31 yields a report about January's work only; default run covers the last 7 days.
- **Must not change:** grounded deviation vs baseline still deterministic; Output-folder write-only invariant holds.

### U12.3 — UI: date-range control on Analysis  ⟶ contained
- **Goal:** surface `DateRangePopover` next to **Run analysis**, default last-week→today, pass it to the route.
- **Change:** [run-analysis-panel.tsx](../../../components/pma/run-analysis-panel.tsx) holds a `DateRange` state (seeded today−7d → today), renders `DateRangePopover`, sends `{startDate,endDate}` in the POST body. Handle the new **"no changes"** response (U12.5) by showing the notice instead of refreshing into an empty report.
- **Done:** control visible, defaulted, reused component; run posts the window.
- **Must not change:** owner/admin gating + disabled-reason affordances unchanged.

### U12.4 — Per-change attribution by name
- **Goal:** each reported change carries the name of who made it; "non noto" if Drive doesn't expose it.
- **Drive constraint (must read):** Google Docs gives **no per-paragraph authorship**. The feasible mechanism is the **revisions API**: `drive.revisions.list` returns revisions each with one `lastModifyingUser.displayName`. To attribute *a part*, diff consecutive revisions **within the window** and attribute each delta to that revision's author. Google **coalesces** minor revisions, so granularity is coarse (per-revision, not per-keystroke). `displayName` is a single field (full name), not separate nome/cognome.
- **Change:**
  - drive client: add `listRevisions(fileId, {since,until})` → `[{id, modifiedTime, authorName|null}]` (fields `revisions(id,modifiedTime,lastModifyingUser(displayName))`).
  - analyze: for each windowed file, gather the window's revision authors; feed `(author, change)` context to Gemini so recap `additions`/`edits` items can be tagged; unknown author → `"non noto"`.
  - synthesize/render: surface the attribution in the report lines.
- **Done:** report changes read e.g. `• Aggiunta sezione budget — Mario Rossi` / `• … — non noto`.
- **Must not change:** no Source writes (revisions.list is read-only); secrets server-only.
- **⚠️ Open risk:** if revision coalescing makes per-part attribution unreliable/too coarse, **fallback = per-file last-modifier** ("modificato da X"). Decide at build if revisions prove insufficient.

### U12.5 — "No changes" notice (no Doc on empty run)
- **Goal:** a windowed run with zero changed files produces **no report Doc** and a clear notice.
- **Change:**
  - [run.ts](../../../lib/pma/run.ts): if `added.length === 0` (and no removed of interest), short-circuit **before** synthesize — record a run row with `status:'no_changes'`, no report link, skip Doc creation + checkpoint advance.
  - [analysis page](../../../app/(app)/w/[workspaceId]/analysis/page.tsx) + run-history row: render `no_changes` runs as "Nessuna nuova modifica nel periodo selezionato" (no "Open report" link).
  - panel: on a `no_changes` result, show the notice inline.
- **Done:** empty-window run creates no `analyses/` Doc; page shows the notice; history row reads "no changes".
- **Must not change:** non-empty runs behave exactly as before (minus the storage/window/attribution changes above).

---

## Dependency / dispatch order
1. **U12.1** (migration + storage move) — foundation, isolated.
2. **U12.2** (windowed detect) — depends on nothing but is the core engine change.
3. **U12.4** (attribution) — builds on U12.2's windowed file set + revisions.
4. **U12.5** (no-change short-circuit) — depends on U12.2's detect result shape.
5. **U12.3** (UI) — depends on the route contract from U12.2 + U12.5 response shape.

Parallel-safe: U12.1 ⟂ U12.2 (different files, no shared write). U12.4/U12.5 follow U12.2. U12.3 last.

## Verification preconditions
- A workspace with Source+Output folders configured + service-account access (live run).
- Source docs with edits across ≥2 dates and ≥2 Google accounts (to test window + attribution).
- Dev DB: apply 0132 incrementally (never `db reset`).
