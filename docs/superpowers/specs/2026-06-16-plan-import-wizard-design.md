# Import a Project Plan — wizard design

- **Date:** 2026-06-16
- **Status:** approved (design); implementation plan to follow
- **Author:** Ali + Claude

## Summary

Turn a project-plan PDF (a bando / "Relazione tecnica" / "Piano di Lavoro") into a
seeded trinno workspace, from inside the app, replacing the manual CLI flow
(`scripts/seeds/<project>.mjs`). A standalone wizard lets a user upload the PDF, have
Gemini extract the structure, **review and edit** the extracted plan, and then build a
new workspace (boards, sub-boards, cards, deliverables, milestones) owned by that user —
optionally creating a native Google Doc per deliverable.

This is the web equivalent of the runbook in `scripts/seeds/README.md`
("Seeding a new project plan from a PDF"), with Gemini doing the
"read the PDF → extract the skeleton" step a human did manually.

## Motivation

Seeding a project plan today is a developer task: read a 100+ page PDF, hand-transcribe
the work packages / tasks / deliverables / dates / milestones into a `.mjs` content
array, build a `.docx` template, run a prod script with the service-role key. The
structure-extraction is the slow, error-prone part, and the whole thing is gated behind
CLI + secrets. The app already has every building block to do this in-product, safely,
for any user's own workspace.

## Goals

- Upload a PDF and get a structured, **editable** draft plan back (no auto-commit).
- Build a new workspace from the approved draft using the app's normal, RLS-checked
  server actions — **no service-role key**, scoped to the requesting user.
- Create a native Google Doc per deliverable and link it on the card (v1, opt-in by
  supplying a Drive folder).
- Reuse the existing Gemini + Drive infrastructure (`lib/pma/clients/*`); add no new SDK
  or secret.

## Non-goals (v1)

- Seeding into an existing workspace, or into someone else's / a prod "official"
  workspace. v1 always creates a **new** workspace owned by the current user.
- The service-role bulk-seed path (`scripts/seeds/*.mjs`) — unchanged, stays the
  CLI/admin tool for the official M.A.R.S./AEGIS prod workspaces.
- An app-owned Drive "Output folder" model (no per-user Drive sharing) — deferred to v2.
- Gemini Files-API ingestion for very large PDFs — v1 is inline only (see Error handling).
- A "Pro" model tier / accuracy toggle — v1 is `gemini-2.5-flash` only.

## Background — what already exists (reused, not rebuilt)

- **Gemini client.** `lib/pma/clients/gemini.ts:54` `generateStructured<T>()` — server-only,
  lazy `GEMINI_API_KEY`, `responseMimeType: application/json` + `responseSchema`. Model
  `gemini-2.5-flash` (`gemini.ts:21`). Currently passes a **text** prompt only
  (`contents: input.prompt`, `gemini.ts:57`).
- **Drive client.** `lib/pma/clients/drive.ts` — service-account client that works in prod
  via `GOOGLE_SERVICE_ACCOUNT_JSON` and in dev via `GOOGLE_APPLICATION_CREDENTIALS`
  (`drive.ts:121-178`). `createDoc(name, parentId, content)` (`drive.ts:384`) makes a
  **native Google Doc** by uploading `text/html` with the Google-Doc target mime → Drive
  converts, carrying formatting. `createFolder(name, parentId)` (`drive.ts:343`) and
  `listFolder` (`drive.ts:201`) exist.
- **Workspace-building `*Impl` functions** (all RLS-checked via `dbAsUser`, all take the
  user's JWT; `seedRichDemoImpl` at `actions/seed.ts:295` already chains them):
  `createWorkspaceImpl` (`actions/workspaces.ts:20`), `createBoardImpl`
  (`actions/boards.ts:39`, `seedDefaultLists` option), `createSubboardImpl(parentBoardId,
  parentCardId)` (`actions/boards.ts:274`), `createListImpl` (`actions/lists.ts:45`),
  `createCardImpl` (`actions/cards.ts:80`), `updateCardImpl` (type/dates/parent/etc,
  `actions/cards.ts:274`), `upsertCardLinkImpl` (the card-scope yellow URL link,
  `actions/links.ts:26` — one per card, DB-enforced; **not** `createCardLinkImpl`, which is
  card-to-card dependencies), `createMilestoneImpl` (`actions/milestones.ts:138`).
- **Auth seam.** `requireUser()` + `getSessionToken()` (`lib/auth.ts:13-25`), used by the
  existing `seedRichDemoWorkspace` action (`actions/seed.ts:900`).
- **File upload reality.** Next.js **server actions cannot receive `File`/`FormData`**;
  the app uploads via a **route handler** + signed URL (`app/api/upload/route.ts`). This
  feature uses a route handler to receive the PDF.

## User flow

A standalone route `app/(app)/import-plan` — a three-step client wizard.

1. **Upload.** Drop a PDF. Optional: paste a Google Drive folder link for the deliverable
   docs (with inline instructions to share it with the service account
   `…@developer.gserviceaccount.com` as Editor). Submit → POST `multipart/form-data` to
   `app/api/import-plan/extract/route.ts`. The handler runs Gemini and returns a
   `ProjectPlan` JSON. Spinner while extracting.
2. **Review & edit.** The `ProjectPlan` renders as an editable structured form:
   workspace name + parent-board title; each work package (code, title, option RI/SS/both,
   start/end dates, description) with its tasks and deliverables (deliverable → which task
   it hangs off, due date, description); the milestones (name, date, description). The user
   corrects anything Gemini misread, adds/removes rows. **Nothing is written to the DB or
   Drive until they confirm.**
3. **Build.** Confirm → server action `buildWorkspaceFromPlan(plan, driveFolderId?)`.
   Builds the workspace under the user's JWT, creates Drive docs if a folder was given,
   returns `{ workspaceId, result }`. On success the wizard routes to
   `/w/{workspaceId}/roadmap`. A partial result (some steps failed) shows which steps and
   links to the half-built workspace so the user can inspect or delete it.

## Architecture & modules

Mirrors `lib/pma/`'s shape: a thin client layer, a pure extract step, a pure-ish build
step, a server-action boundary, a route handler, and UI. Each module has one job.

### `lib/plan-import/types.ts`
The data contract. A `ProjectPlan` TypeScript type **and** the matching genai `Schema`
(the JSON contract Gemini must satisfy). One source of truth for both the extractor and
the builder.

```
ProjectPlan {
  workspaceName: string
  parentBoardTitle: string
  workPackages: WorkPackage[]
  milestones: Milestone[]
}
WorkPackage {
  code: string            // "WP1"
  title: string
  option: "RI" | "SS" | "RI+SS"
  start: string           // "YYYY-MM-DD"
  end: string             // "YYYY-MM-DD"
  description: string
  lead?: string           // partner/leader, for the doc subtitle
  tasks: { title: string; description: string }[]
  deliverables: {
    title: string
    taskIndex: number     // which task in this WP it hangs off
    due: string           // "YYYY-MM-DD"
    month: number         // M-number for the subtitle
    description: string
  }[]
}
Milestone { name: string; date: string; description: string }
```

- **Depends on:** `@google/genai` (`Schema` type only).
- **Consumers:** `extract.ts`, `build.ts`, the review UI.

### `lib/pma/clients/gemini.ts` (additive change)
Extend `StructuredInput` with an optional `files?: { mimeType: string; data: string }[]`
(base64). When present, `contents` becomes `[...files.map(f => ({ inlineData: f })),
{ text: prompt }]`; when absent, behaviour is byte-identical to today. **PMA's text-only
calls are unaffected.** This keeps one Gemini seam instead of duplicating the SDK wrapper.

- **Depends on:** `@google/genai`, `GEMINI_API_KEY`.
- **Consumers:** existing PMA (`analyze.ts`, `synthesize.ts`) + new `extract.ts`.

### `lib/plan-import/extract.ts`
`extractPlanFromPdf(pdfBytes: Buffer): Promise<ProjectPlan>`. Base64-encodes the PDF,
calls `generateStructured<ProjectPlan>` with the PDF as an inline part + the extraction
prompt (knows the WP/task/deliverable/milestone shape, the English-output convention, and
to derive milestones from WP end-dates + named mid-term/closure deliverables when the PDF
has no milestone table) + `responseSchema` from `types.ts`. Throws a typed error on
empty/non-JSON output (surfaced on the upload step).

- **Depends on:** `gemini.ts`, `types.ts`.
- **Consumer:** the extract route handler.

### `lib/plan-import/build.ts`
`buildWorkspaceFromPlan(token, plan, driveFolderId?): Promise<BuildResult>`. The `*Impl`
chain, mirroring `seedRichDemoImpl` + the `aegis.mjs` structure but RLS-safe under the
user's JWT:

```
createWorkspaceImpl
  → createBoardImpl (parent, seedDefaultLists)
  → for each WP:
      createCardImpl (anchor card on parent board)
      createSubboardImpl (parentBoardId, parentCardId)
      createListImpl ×3 (or seedDefaultLists)
      for each task: createCardImpl (+ updateCardImpl for type/dates)
      for each deliverable:
        createCardImpl (subtask, parent = its task)
        if driveFolderId: drive-docs.createDeliverableDoc → webViewLink
        upsertCardLinkImpl (card-scope yellow URL link), url = doc link or placeholder
  → for each milestone: createMilestoneImpl (pinned to parent board)
```

Same **partial-result contract** as `seed.ts` (`seedStep`/`SeedResult`,
`actions/seed.ts:45-77`): each step wrapped, failures collected, a partial workspace is
acceptable and user-deletable. Returns `{ workspaceId, ok, partial, failures }`.

- **Depends on:** the `*Impl` functions, `drive-docs.ts`, `types.ts`.
- **Consumer:** `actions/plan-import.ts`.

### `lib/plan-import/drive-docs.ts`
`createDeliverableDoc({ folderId, wpTitle, deliverableTitle, subtitle }) → { webViewLink }`.
Find-or-create the `<folderId>/<WP title>/Deliverables/` hierarchy (via `listFolder` +
`createFolder`, cached per build), then `createDoc(deliverableTitle, deliverablesFolderId,
html)` where `html` = a small HTML body (`<h1>` title, subtitle line, the standard
section skeleton). Idempotent find-or-create by name like the CLI. A `probeFolder(folderId)`
helper verifies the SA can write **before** any build step runs (fail-fast).

- **Depends on:** `lib/pma/clients/drive.ts`.
- **Consumer:** `build.ts`.
- **Note:** HTML→native-Doc replaces the CLI's `.docx`-template + zipfile-patch approach
  entirely — no template file, no placeholders, no Docs API.

### `actions/plan-import.ts`
`buildWorkspaceFromPlan(plan, driveFolderId?)` — public server action: `requireUser()` +
`getSessionToken()`, validates `plan` with a Zod schema (mirrors `ProjectPlan`), calls
`lib/plan-import/build.ts`, `revalidatePath("/")`, returns `{ workspaceId, result }`.

- **Depends on:** `lib/auth.ts`, `lib/plan-import/build.ts`, Zod validation.
- **Consumer:** the wizard's Build step.

### `app/api/import-plan/extract/route.ts`
`POST` route handler (receives the PDF as `FormData`, which server actions can't).
`requireUser()`; read the `File`, enforce the size cap, `extractPlanFromPdf(bytes)`, return
the `ProjectPlan` JSON (or a typed error). The PDF is **transient** — never persisted to a
bucket or to Drive.

- **Depends on:** `lib/auth.ts`, `lib/plan-import/extract.ts`.
- **Consumer:** the wizard's Upload step.

### `app/(app)/import-plan/page.tsx` + `components/import-plan/*`
The wizard shell (`requireUser()` server page) + client step components: `UploadStep`
(file input + Drive-folder field + SA-share instructions), `ReviewStep` (editable plan
form), `BuildStep` (progress + result/partial-failure display, route on success).

## Data flow diagram

```
[browser] PDF + folder link
   │  multipart POST
   ▼
app/api/import-plan/extract  ──►  lib/plan-import/extract  ──►  lib/pma/clients/gemini (+files)
   │                                                                  │
   ◄──────────────── ProjectPlan JSON ◄──────────────────────────────┘
   ▼
[browser] Review & edit  ── user confirms ──►  actions/plan-import.buildWorkspaceFromPlan
                                                   │
                                  lib/plan-import/build  ──►  *Impl (RLS, user JWT)  ──►  DB rows
                                                   │
                                          (if folder) lib/plan-import/drive-docs ──► lib/pma/clients/drive.createDoc
                                                   ▼
                                          { workspaceId, result } ──► route to /w/{id}/roadmap
```

## Access & cost

- **Gating:** none beyond `requireUser()` (per decision) — same posture as the existing
  Developer "seed rich" button.
- **Model:** `gemini-2.5-flash` only. One call per import over a multi-page PDF; Flash is
  the cheap tier and is sufficient for structured extraction of these plans.
- **Secrets:** `GEMINI_API_KEY` (already required by PMA) and the Drive service account
  (`GOOGLE_SERVICE_ACCOUNT_JSON` in prod). Both already needed by PMA — **deploy-config
  follow-up:** confirm they are set in the Vercel prod/preview env (recon found
  `.env.cloud`/`.env.vercel` did not have the SA), else Drive-doc creation no-ops with the
  placeholder fallback and extraction fails without the key.

## Error handling

- **Extraction:** empty/non-JSON from Gemini → typed error on the Upload step, with retry
  and a "skip extraction, enter manually" escape (start the review form blank). The Review
  step is the safety net for partial/incorrect extraction.
- **Build:** the `SeedResult` partial-result contract — each `*Impl` step wrapped, failures
  collected; a partial workspace is returned with the failed step names and a link to
  inspect/delete it. No silent loss.
- **Drive:** `probeFolder` runs before the build writes anything; if the SA can't write
  there, the build proceeds with **placeholder** deliverable links + a visible warning,
  rather than aborting the whole import (DB workspace is the primary artifact).
- **Size:** PDF over the inline cap (~15MB) → clear error pointing at the v2 Files-API path.

## Security / risk

Tier 2–3 (creates workspaces, a new upload route handler, paid external API, Drive writes)
— but materially de-risked: the DB build is **RLS-checked under the user's own JWT**
(no service-role; workspace creation is already an unprivileged user capability, proven by
the existing seed button), the PDF is transient, and the Gemini/Drive secrets are
server-only and already in the codebase. Implementation should still run through
`ai-dev-control` (the route handler accepting uploads + the paid-API path warrant the
verify gate). No DB migration is required.

## Testing

- `lib/plan-import/extract.ts` — unit test with a mocked `generateStructured` returning a
  fixture `ProjectPlan`; assert prompt/schema wiring and the empty/non-JSON error path.
- `lib/plan-import/build.ts` — integration test like `tests/integration/seed-demo.test.ts`:
  admin-create a user → JWT → `buildWorkspaceFromPlan(fixturePlan)` → assert workspace,
  boards/sub-boards, card counts/types/dates, links, milestones; plus a forced-failure case
  asserting the partial-result contract.
- `lib/plan-import/drive-docs.ts` — unit-test the HTML builder; the find-or-create against
  Drive covered by a smoke script (not CI).
- `scripts/plan-import/extract-smoke.ts` — run `extractPlanFromPdf` against a real bando
  PDF and print the plan (mirrors `scripts/pma/gemini-smoke.ts`).
- Wizard components — light render/interaction tests for the review-edit form.

## Open considerations / v2

- **Drive folder friction.** v1 requires each user to share a folder with the SA. v2: an
  app-owned Output-folder model (per-import subfolders), the pattern PMA already uses, so
  users never touch Drive sharing.
- **Large PDFs.** v2: Gemini Files-API ingestion to lift the inline-size cap.
- **Cost controls.** If usage grows, add a feature flag / rate limit / `@innovina.it`
  gate — deliberately omitted from v1 per the access decision.
- **Re-import / idempotency.** v1 always creates a new workspace (no dedup); re-importing
  the same PDF makes a second workspace. Matches the in-app seed button's behaviour.
