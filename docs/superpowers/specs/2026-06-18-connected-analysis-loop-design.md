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
- Keep the change contained: no new tables; the recap / synthesis / reconcile
  logic is untouched. (One deliberate addition: a per-type content adapter so
  PDFs and Office files are analyzable too — see File-type support.)

## Non-goals (explicitly out of scope)

- Per-document or per-card SELECTION for a run. Rejected on purpose: a synthesis
  report's value is the relationships between documents; cherry-picking one file
  strips that context and is misleading. A run always covers the coherent set.
- Making documents a first-class entity / a `documents` table / a `card_id` on
  the registry. Not needed once selection is dropped.
- Surfacing recaps on cards / a "report card" per run.
- Re-architecting the Gemini engine's recap / synthesis / reconcile logic (only a
  per-type content adapter is added — see File-type support).

## Decisions (the converged model)

1. **A run = a time range over the project's whole document set → one report,
   in context.** This is the existing window mode. No picking.
2. **Recursive folder read.** The Documents-folder scan walks subfolders, so
   plan-import's nested deliverable Docs are included. This is the core connector.
3. **Two sibling folders (option A).** Analysis uses a **`Documents/`** folder
   (read recursively) and a **`Reports/`** folder (written to, never read). In
   **Auto** mode trinno provisions both as siblings under the project —
   `<project>/Documents` and `<project>/Reports` — so one Auto action sets up
   both, with clean separation and NO exclude logic (Reports is not inside
   Documents). In **Manual** mode the user pastes their Documents folder and
   trinno creates a `Reports` folder for output; the recursive scan additionally
   skips any folder named `Reports` as a safety net. Internally these map to the
   EXISTING workspace `source` / `reports` links (no schema change) — but the
   user sets them in ONE action; the separate manual "Reports folder" field is
   removed. (Folder names `Documents` / `Reports` are easily changed later.)
4. **Reused folder-setup control.** The import wizard's Drive-mode control
   (`Auto | Manual`) is mounted on the Analysis page. `Auto` provisions the
   `<project>/{Documents, Reports}` pair by name under the shared Trinno root
   (find-or-create, idempotent) and sets both workspace links; `Manual` pastes
   the Documents folder link and trinno creates the `Reports` folder for output.
5. **Import auto-wires the loop.** When plan-import runs with Drive **Auto or
   Manual** (a folder is available), it provisions `<project>/{Documents,
   Reports}` and sets both workspace links — so the workspace is born ready and a
   future report lands in `<project>/Reports/` with no manual setup. With Drive
   **Off** (no folder), nothing is set; the user configures it later via the
   Analysis-page `Auto | Manual` control. The user never hand-configures the
   Reports folder in any mode.
6. **Recap stays internal plumbing** (never shown). No-op in the UI.
7. **Config moves onto the Analysis page** (the folder control + the run control
   live together). The folder fields are REMOVED from manage-workspace Settings
   so there is a single place to set the Documents folder. (Reversible if review
   prefers keeping a read-only pointer in Settings.)

## File-type support (in scope)

Today only **Google-native docs** (Docs/Sheets/Slides) are content-analyzed;
PDF/Office/images are counted but unread (`EDITABLE_MIME_TYPES` in
[detect.ts](../../../lib/pma/detect.ts), `EXPORT_MIME` in
[drive.ts](../../../lib/pma/clients/drive.ts)). This work EXPANDS the analyzable
set via a per-type **content adapter** that feeds the existing Flash recap:

- **Google Docs / Sheets / Slides:** export to text — today's path, unchanged.
- **PDF / images:** download the file bytes and send them to Gemini as a native
  file part (the import extractor already does this — reuse the `files` support
  in [gemini.ts](../../../lib/pma/clients/gemini.ts)). No conversion.
- **Office (.docx / .xlsx / .pptx):** convert via Drive `files.copy` into the
  matching Google-native type (Doc/Sheet/Slides), export its text, then **trash
  the temporary copy** (try/finally, even on error). Uses Drive's own conversion
  — no local converter, no new dependency.

Notes:
- The recap / synthesis / reconcile logic is unchanged — the recap takes text OR a
  file part; the report is built the same way.
- The version gate still works (Drive `version` is populated for all file types),
  so unchanged files are still skipped across runs.
- Cost / latency: PDFs and images add Gemini file-input cost; Office adds a
  copy-convert-export-trash round-trip per changed file. Acceptable for periodic
  runs; flagged for the plan.
- Cleanup is mandatory: every temporary Office conversion MUST be trashed even on
  failure, so the folders never accumulate temp Docs.

## Architecture

### Folder layout (per workspace / project)

```
<project>/
├── Documents/                  ← the documents folder (read RECURSIVELY)
│   ├── <WP>/Deliverables/<doc>    ← plan-import output
│   └── …any nested docs…
└── Reports/                    ← analysis OUTPUT; a SIBLING of Documents, never scanned
    └── <report Google Doc>
```

Invariant: trinno reads only `Documents/` and writes only `Reports/`. Because
Reports is a sibling (not inside Documents), the recursive scan never sees it —
no exclude logic needed in Auto. In Manual mode, where a user's pasted folder may
hold the Reports folder as a child, the scan additionally skips any folder named
`Reports` as a safety net. plan-import writes deliverable Docs under
`<project>/Documents/<WP>/Deliverables/…` (one level deeper than today, so they
sit under the read root).

### Entities

Unchanged. `pma_file_registry` (the per-file recap/version/state) and
`pma_analysis_runs` (run history → report link) stay as they are, and the
workspace `source` / `reports` link rows are reused. Cards stay as they are — the
human-facing home for a deliverable's Doc link; analysis does not go through them.
No new columns, no new tables.

### Flows

**Import (plan-import):**
1. Build workspace + deliverable cards + deliverable Google Docs under
   `<project>/Documents/<WP>/Deliverables/…`.
2. If a Drive folder is available (Auto or Manual mode), provision
   `<project>/{Documents, Reports}` and set both workspace links. Off mode: skip
   — the user configures it later on the Analysis page.

**Analyze (one page: configure + run):**
1. User sets the Documents folder via the `Auto | Manual` control (or it is
   already set from import); Auto/Manual also establishes the Reports folder.
2. User picks a time range (or none = whole document) and runs (existing control).
3. `detect` scans the **Documents** folder RECURSIVELY for files changed in the
   range (Reports is a sibling, not scanned).
4. `analyze` (Flash recap, cached) → `synthesize` (Pro) → one report Doc written
   to the **Reports** folder → `reconcile` records the run (existing).
5. The Analysis page lists the run (time · period · summary · "Open report ↗").

## Concrete change list

- **Recursive scan** (`lib/pma/clients/drive.ts` + `lib/pma/detect.ts`): walk
  subfolders of the Documents folder. Add a safety-net skip for any folder named
  `Reports` (covers Manual, where Reports may sit inside the pasted folder).
- **Content adapter by file type** (`lib/pma/detect.ts` categorize +
  `lib/pma/analyze.ts` + `lib/pma/clients/drive.ts`): expand the analyzable set to
  PDF, images, and Office. Google-native → export text (today); PDF/image →
  download bytes → Gemini file part; Office (.docx/.xlsx/.pptx) → Drive
  copy-convert → export text → trash the temp. Recap / synthesis prompts unchanged.
- **Output goes to the Reports folder directly** (`lib/pma/output.ts`): write the
  report Doc into the workspace's Reports folder; drop the `analyses/` subfolder
  (Reports IS the output folder now).
- **One-action folder setup, two links:** the Auto/Manual control sets BOTH the
  `source` (Documents) and `reports` (Reports) workspace links. Reuse the existing
  link rows — no schema change. `getRunInputs` (`lib/pma/inputs.ts`) already
  reads both.
- **Reuse the Drive-mode control** (`components/import-plan/drive-mode-control.tsx`)
  on the Analysis page; `Auto` provisioning creates the `<project>/{Documents,
  Reports}` pair via the same resolve-by-name helper plan-import uses.
- **Import provisions + links both folders** for the workspace it creates
  (Auto/Manual); skipped in Off mode (`lib/plan-import/build.ts`). Deliverable
  Docs move under `Documents/`.
- **Settings:** remove the manual folder fields (Reports is now auto-managed); the
  Documents-folder control lives on the Analysis page (single home), labeled
  "Documents folder (subfolders included)".

## Consistency / error handling

- Auto needs no exclude logic (Reports is a sibling of Documents). The Manual
  safety-net skip of a `Reports` folder name keeps reports out of the scan if they
  live inside the pasted folder.
- Existing retry/version semantics are unchanged (errors leave `last_version`
  untouched so a file retries next run).
- **Optional hardening (recommended, can defer):** a per-workspace advisory lock
  around a run so two concurrent runs cannot both produce a report. Today there
  is no lock; concurrent runs can duplicate reports. Cheap to add; flagged for
  the implementation plan to accept or defer.

## Testing

- Unit: recursive lister includes nested files; `getRunInputs` resolves source =
  Documents, reports = Reports; the Manual safety-net excludes a `Reports` child.
- Integration: a run over `<project>/Documents` (with a nested Deliverables doc)
  analyzes it and writes the report to `<project>/Reports`, ignoring any existing
  report; import provisions both folders + sets both links.
- E2E (manual/live, per project norms — JSX is not render-tested): set the folder
  via the Auto control on the Analysis page, run, confirm one report in
  `Reports/` and a row on the Analysis page.
- File types: each content-adapter branch — Google-native exports text; a
  PDF/image is sent as a file part; an Office file is copy-converted, read, and its
  temporary copy is trashed even when the read throws.

## Diagram

```
  PLAN IMPORT ──creates──► NEW WORKSPACE
       │                     ├─ deliverable CARDS (Doc links = human view)
       │                     └─ provisions <project>/{Documents, Reports} + links
       │
       └── writes Docs ──► <project>/Documents/ … /WP/Deliverables/<doc>
                                   │
                                   ▼   read RECURSIVELY
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
                       │  Report Doc → <project>/Reports/ (sibling)│
                       │  + listed on Analysis page                │
                       │  (time · period · summary · Open report ↗)│
                       └─────────────────────────────────────────┘

  Import and analysis meet at the SHARED <project> folder: docs in Documents/,
  reports out to the sibling Reports/ (never scanned). Docs/Sheets/Slides, PDFs,
  images, and Office files are all content-analyzed via a per-type adapter.
```
