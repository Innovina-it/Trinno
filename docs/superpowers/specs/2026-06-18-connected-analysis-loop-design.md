# Connected analysis loop — design

- Date: 2026-06-18
- Status: approved (design), pending implementation plan
- Area: PMA (PM Assistant / "Analysis") + plan-import, Google Drive wiring

## Problem

Three features touch Google Drive — plan-import, PMA "Run analysis", and the
workspace folder links — and they feel disconnected because they ARE
disconnected:

1. **Four folder concepts, none aware of the others:** workspace Source folder,
   workspace Reports folder, plan-import's project folder, and per-card links.
   Folder setup uses different UX in each place (segmented Auto/Manual/Off in
   import vs paste-a-link in settings).
2. **Flat read vs nested write (proven):** PMA's `listFolder` lists one level
   (`'<id>' in parents`, [drive.ts](../../../lib/pma/clients/drive.ts)), but
   plan-import writes Docs nested under `<project>/<WP>/Deliverables/…`
   ([drive-docs.ts](../../../lib/plan-import/drive-docs.ts)). So the documents
   the importer creates are invisible to the analyzer.
3. **Config here, action there:** the analysis input/output folders are set in
   manage-workspace Settings, but a run is triggered on a separate Analysis page.
4. **Recap confusion:** `recap_json` reads like a user feature but is internal
   plumbing (it builds the report and caches unchanged files); it is never shown
   in the UI today.

## Goals

- Close the import → analyze loop: the Docs plan-import creates are the Docs
  analysis reads.
- One consistent folder-setup UX, reused from the import wizard.
- Configure-and-run in one place.
- Keep the change small: no new tables, no engine rewrite, recap untouched.

## Non-goals (explicitly out of scope)

- Per-document or per-card SELECTION for a run. Rejected on purpose: a synthesis
  report's value is the relationships between documents; cherry-picking one file
  strips that context and is misleading. A run always covers the coherent set.
- Making documents a first-class entity / a `documents` table / a `card_id` on
  the registry. Not needed once selection is dropped.
- Surfacing recaps on cards / a "report card" per run.
- Re-architecting the Gemini engine (detect / analyze / synthesize / reconcile).

## Decisions (the converged model)

1. **A run = a time range over the project's whole document set → one report,
   in context.** This is the existing window mode. No picking.
2. **Recursive folder read.** The documents-folder scan walks subfolders, so
   plan-import's nested deliverable Docs are included. This is the core connector.
3. **One folder per workspace** (the "documents folder"). Reports are written to
   a subfolder named **`auto analysis`** inside it. The recursive scan EXCLUDES
   any folder named `auto analysis`, so analysis never re-analyzes its own
   reports. The separate "Reports folder" config is removed.
4. **Reused folder-setup control.** The import wizard's Drive-mode control
   (`Auto | Manual`) is mounted on the Analysis page to set the documents folder.
   `Auto` provisions/resolves the folder by name under the shared Trinno root
   (find-or-create, idempotent); `Manual` pastes a link.
5. **Import auto-wires the loop.** plan-import sets the new workspace's documents
   folder to the `<project>` folder it creates. Because `Auto` also resolves by
   name, an imported workspace is analyzable immediately with no manual step.
6. **Recap stays internal plumbing** (never shown). No-op in the UI.
7. **Config moves onto the Analysis page** (the folder control + the run control
   live together). The folder fields are REMOVED from manage-workspace Settings
   so there is a single place to set the documents folder. (Reversible if review
   prefers keeping a read-only pointer in Settings.)

## Architecture

### Folder layout (per workspace / project)

```
<project>/                     ← the documents folder (configured: Auto or Manual)
├── <WP>/Deliverables/<doc>    ← plan-import output; read RECURSIVELY by analysis
├── …any nested docs…          ← read RECURSIVELY
└── auto analysis/             ← analysis OUTPUT (reports); EXCLUDED from the scan
    └── <report Google Doc>
```

Changed invariant: previously "trinno writes only to a separate Output folder,
never the Source." Now: trinno writes only to the `auto analysis/` subfolder of
the documents folder, and the scan excludes that subfolder. One folder, controlled
write location, no feedback loop.

### Entities

Unchanged. `pma_file_registry` (the per-file recap/version/state) and
`pma_analysis_runs` (run history → report link) stay as they are. Cards stay as
they are — they remain the human-facing home for a deliverable's Doc link;
analysis does not go through them. No new columns, no new tables.

### Flows

**Import (plan-import):**
1. Build workspace + deliverable cards + deliverable Google Docs under
   `<project>/<WP>/Deliverables/…` (existing).
2. Set the new workspace's documents folder = `<project>` (new, small).

**Analyze (one page: configure + run):**
1. User sets the documents folder via the `Auto | Manual` control (or it is
   already set from import).
2. User picks a time range (or none = whole document) and runs (existing control).
3. `detect` scans the documents folder RECURSIVELY, excluding `auto analysis/`,
   for files changed in the range.
4. `analyze` (Flash recap, cached) → `synthesize` (Pro) → one report Doc written
   to `<project>/auto analysis/` → `reconcile` records the run (existing).
5. The Analysis page lists the run (time · period · summary · "Open report ↗").

## Concrete change list

- **Recursive scan + exclude** (`lib/pma/clients/drive.ts` listFolder or a new
  recursive lister; `lib/pma/detect.ts`): walk subfolders; skip any folder named
  `auto analysis`.
- **Rename the output subfolder** `analyses` → `auto analysis`
  (`lib/pma/output.ts` `ANALYSES_FOLDER`).
- **Single-folder config:** drop the separate reports-folder link; reports derive
  as `<documents folder>/auto analysis/`. Update `getRunInputs`
  (`lib/pma/inputs.ts`) and the run precondition.
- **Reuse the Drive-mode control** (`components/import-plan/drive-mode-control.tsx`)
  on the Analysis page for the documents folder; wire `Auto` provisioning to the
  same resolve-by-name helper plan-import uses.
- **Import sets the documents folder** for the workspace it creates
  (`lib/plan-import/build.ts` + the workspace link write).
- **Settings:** remove both folder fields from manage-workspace Settings; the
  documents-folder control now lives on the Analysis page (single home), labeled
  "Documents folder (subfolders included)".

## Consistency / error handling

- The recursive scan must exclude `auto analysis` reliably (by exact folder
  name) so reports are never treated as source documents.
- Existing retry/version semantics are unchanged (errors leave `last_version`
  untouched so a file retries next run).
- **Optional hardening (recommended, can defer):** a per-workspace advisory lock
  around a run so two concurrent runs cannot both produce a report. Today there
  is no lock; concurrent runs can duplicate reports. Cheap to add; flagged for
  the implementation plan to accept or defer.

## Testing

- Unit: recursive lister includes nested files and EXCLUDES `auto analysis`;
  output subfolder name is `auto analysis`; single-folder `getRunInputs`
  resolves source = folder, reports = `<folder>/auto analysis/`.
- Integration: a run over a folder tree (with a nested Deliverables doc and an
  existing `auto analysis/` report) analyzes the nested doc and ignores the
  prior report; import sets the workspace documents folder.
- E2E (manual/live, per project norms — JSX is not render-tested): set folder via
  the Auto control on the Analysis page, run, confirm one report in
  `auto analysis/` and a row on the Analysis page.

## Diagram

```
  PLAN IMPORT ──creates──► NEW WORKSPACE
       │                     ├─ deliverable CARDS (Doc links = human view)
       │                     └─ sets "Documents folder" = <project> Drive folder
       │
       └── writes Docs ──► <project>/ … /WP/Deliverables/<doc>   (Drive, nested)
                                   │
                                   ▼   read RECURSIVELY (skip "auto analysis/")
                       ┌─────────────────────────────────────────┐
                       │   ANALYSIS PAGE (configure + run here)    │
                       │   folder via Auto|Manual control          │
                       │   input: a TIME RANGE  (no picking)       │
                       └─────────────────────┬─────────────────────┘
                                             ▼
                                   RUN  (Gemini engine;
                                         recap = internal plumbing)
                                             │  one report per run
                                             ▼
                       ┌─────────────────────────────────────────┐
                       │  Report Doc → <project>/auto analysis/    │
                       │  + listed on Analysis page                │
                       │  (time · period · summary · Open report ↗)│
                       └─────────────────────────────────────────┘

  Import and analysis meet at the SHARED <project> Drive folder — same files in,
  reports out to auto analysis/ (excluded from the scan).
```
