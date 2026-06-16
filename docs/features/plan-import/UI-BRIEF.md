# Import-plan wizard — UI elevation design brief (impeccable shape)

- **Date:** 2026-06-16
- **Surface:** `/import-plan` wizard (`components/import-plan/*`, `app/(app)/import-plan/page.tsx`)
- **Register:** product · **Color strategy:** Restrained (monochrome doctrine)
- **Status:** awaiting confirmation; then implement under ai-dev-control

## 1. Feature summary
Elevate the working-but-flat import wizard (Upload → Review → Build) to ship quality inside trinno's monochrome "studio console" system. Internal operators drop a 100-page bando PDF, fix the few things the model misread, and commit. The screen must read as one calm, scannable flow, not a wall of inputs, and must feel like the same tool as the board and roadmap.

## 2. Primary user action
On the **review step** (the heart): scan the extracted plan, correct the handful of fields the model got wrong, build with confidence. Every layout choice serves *scan → correct → commit*.

## 3. Design direction
- **Color strategy: Restrained / monochrome**, per DESIGN.md's Idle Mute Rule. Grayscale by doctrine. The only chroma permitted: the existing cyan focus glow on inputs (user-gesture-gated) and the magenta invalid ring on errors. No status colors here (an unbuilt plan has no workflow state), no accent fills, no illustration.
- **Theme:** dark studio console (locked by DESIGN.md). Scene sentence: *an operator at their desk mid-session, dropping a long grant PDF into the tool and triage-editing the machine's reading of it before committing, focused and a little skeptical of the AI, wanting to verify fast.*
- **Anchor references:** the app's own board/roadmap surfaces (this must feel like one tool), terminal-native density, the "studio console." **Anti-reference: the RevelForm modal** (illustrated cards, light theme, purple, celebratory) and every PM-tool reflex named in PRODUCT.md.

## 4. Scope
Production-ready. The whole wizard surface (3 steps), shipped-quality interactive components, all states, WCAG 2.2 AA + `prefers-reduced-motion`. Runs through the ai-dev-control gates.

## 5. Layout strategy
- **Centered single column** (keep `max-w-3xl`). Persistent **stepper** at top: `UPLOAD · REVIEW · BUILD` in mono-meta (11px uppercase, 0.08em). Monochrome only: active = `--fg` with a filled dot, done = `--fg-muted`, upcoming = `--fg-faint`. Structural, no color, no glow.
- **Upload step:** a real **drop-zone** — tall `rounded-2xl` region, `--surface` fill, **dashed `--hairline-hi`** border (dashed outlines are sanctioned at hairline-hi), lifting to `--surface-strong` + solid `--hairline-hi` on drag-over (transform/opacity only). Terse instruction in body + an Instrument-serif-italic size hint. The Drive-folder field sits below as a clearly secondary option, its SA-share note in `--fg-faint`.
- **Review step:** each work package is a **tonal container** (`--surface` + `--hairline`, `rounded-xl`) — NOT decorative glass (the page doesn't float; glass is structural-only per the Glass-Is-Structural Rule). Collapsed by default: a one-line header = WP code in mono-meta + title in `title` weight + counts in mono-meta (`4 TASKS · 1 DELIVERABLE`) + a chevron. Expanded reveals the editable fields. Inside, tasks and deliverables are **plain rows divided by hairlines, never nested cards** (nested cards are always wrong). Sublabels `TASKS` / `DELIVERABLES` in mono-meta. Rhythm: tight within a group, more air between groups (vary spacing, don't pad uniformly). Milestones follow as a flat row list in the same grammar.
- **Sticky footer:** an **opaque** bar (`--bg-1`, hairline-top — page chrome, not a floating popover, so solid is correct) pinned to the viewport bottom. Left: live plan summary in mono-meta (`5 WP · 20 TASKS · 12 DELIVERABLES · 6 MILESTONES`, recomputed as the user edits/removes). Right: `Back` (ghost) + the single primary CTA (filled white pill). The commit is always one glance away, no scroll-hunting.

## 6. Key states
- **Upload idle / drag-over / invalid-file** (reject non-PDF with a terse inline note).
- **Extracting:** Review dot pulses (static under reduced-motion), status line "Reading the plan. This can take up to a minute.", inputs disabled. Loud-on-action is allowed — extraction is a deliberate gesture.
- **Extraction error:** magenta invalid idiom, the reason, retry + "enter it by hand" escape.
- **Review default / a WP edited down to 0 tasks** (still renders, counts show `0 TASKS`).
- **Building:** Build step active, CTA → disabled spinner.
- **Build partial-failure:** failed steps listed in the magenta idiom + "Open the partial workspace".
- **Reduced-motion:** kill pulse and any drift; chevron/drop-zone transitions become opacity-only or instant.

## 7. Interaction model
- Stepper reflects the current phase; not forward-clickable (can't skip). Back via the footer.
- Drop-zone: click → file dialog; drag-drop a PDF; both feed the existing `/api/import-plan/extract` fetch (server actions can't take a File — already handled by the route).
- WP header is a `<button>`: click / Enter / Space toggles expand; chevron rotates via `transform`; focus = the 1px `--fg`/40 ring.
- Dates: the app's `DatePicker` popover, with a thin YYYY-MM-DD ↔ `Date` adapter at the edges.
- Remove (ghost trash) on WP/task/deliverable/milestone; footer counts update live.
- Hit targets ≥32px primary, ≥24px on the dense trash/chevron affordances.

## 8. Content requirements (clinical, terse, NO em dashes)
- Stepper: `UPLOAD` · `REVIEW` · `BUILD`.
- Upload: drop-zone "Drop a project-plan PDF, or click to choose."; serif-italic hint "PDF up to 15 MB"; Drive field "Google Drive folder for deliverable docs (optional)" + fg-faint SA-share note.
- Extracting: "Reading the plan. This can take up to a minute."
- Error: "Couldn't read that PDF: {reason}. Try again, or enter the plan by hand."
- Review sublabels: `TASKS`, `DELIVERABLES`, `MILESTONES (n)`; counts `n TASKS · n DELIVERABLES`.
- Footer summary: `n WP · n TASKS · n DELIVERABLES · n MILESTONES`.
- Primary CTA: **"Build workspace"** (drop the current em-dash "Looks right — build workspace"; em dashes are banned, and the stepper already says BUILD). Back: "Back".
- Build: "Building your workspace."; partial: "Built with some issues:" + steps.

## 9. Recommended references (during build)
`layout.md` (hierarchy, spacing, rhythm), `interaction-design.md` (form-heavy editing), `clarify.md` (terse copy + errors), `audit.md` (WCAG + reduced-motion). Motion stays transform/opacity on ease-out-quart per DESIGN.md.

## 10. Open questions (resolve in build)
- DatePicker is DD/MM/YYYY + `Date`; the adapter must round-trip the plan's YYYY-MM-DD cleanly (and tolerate a blank/invalid date the user is mid-typing).
- Whether the stepper persists visually on the Build step or compresses — minor.
- Drop-zone reject copy for an oversized (>15 MB) file vs a non-PDF — two distinct messages.
