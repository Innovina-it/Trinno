# Date Range Popover — Typeable Inputs

**Date:** 2026-06-15
**Status:** Approved, pending implementation plan

## Problem

Two date calendars in the app are range pickers (`DateRangePopover`) that can
only be set by **clicking** the grid — there is no way to type a date. The rest
of the app uses the single-date `DatePicker`, which has a typeable text field
(`dd/mm/yyyy`, slashes entered manually). Users want to be able to type into the
two range calendars too.

The two affected call sites:

- [roadmap-dates-section.tsx:136](../../../components/board/card/roadmap-dates-section.tsx#L136)
  — the date section inside a card's **advanced settings** (start/target of the card).
- [run-analysis-panel.tsx:129](../../../components/pma/run-analysis-panel.tsx#L129)
  — the PMA analysis panel range scope.

`card-quick-view.tsx` is **not** affected — it already uses the typeable
`DatePicker`, not the range popover.

## Scope

Single shared component: [components/ui/date-range-popover.tsx](../../../components/ui/date-range-popover.tsx).
Both call sites inherit the change with no edits of their own. The unused
`DatePopover` export in the same file is out of scope (dead code, left as-is).

## Design

### 1. Trigger → two inline text fields

Replace the single `<button>` trigger (which shows `"1 Jun — 14 Jul · 6w"`) with
an inline container styled like `DatePicker`'s field: a calendar icon plus **two
text inputs** (start / target) separated by an em-dash, and the duration suffix
(`· 6w`) shown after the second field when both dates are set.

- Focusing or clicking either input opens the calendar grid (mirrors
  `DatePicker`'s `onFocus → tryOpen`).
- Grid clicking, presets, two-step selection, range preview, and the duration
  readout are all **unchanged**. When the grid sets a value, the text fields
  resync from `value` via a `useEffect` (same mechanism as `DatePicker`).

### 2. Typing logic — coherent with `DatePicker`

- Reuse the `dd/mm/yyyy` parser. `parseDisplayDate` currently lives inside
  `date-picker.tsx`; extract it into a shared helper (alongside `formatDate` in
  `lib/format-date.ts`) and have both components import it, so the parse rule is
  defined once.
- **Start field:** valid parse → commit `start`. Empty → `start = null`.
- **Target field:** valid parse **only if ≥ start** → commit `target`. If the
  typed target is before `start`, keep the typed text but mark the field
  `aria-invalid` and **do not commit** — exactly how `DatePicker` treats a date
  below `minDate` (the value is "not-yet-valid": editable, flagged, uncommitted).
  Empty → `target = null`.
- No auto-swap on typing. Auto-swap stays only on grid two-step click (existing
  behavior). No surprise reordering mid-typing.
- No new minimum-date restriction is introduced; the range popover has never had
  one and that stays true. The only ordering constraint is target ≥ start.

### 3. Unchanged

Two-month grid, two-step grid selection with auto-order, presets, range preview
highlight, duration label, click-outside / Esc close.

### 4. Testing

- Add `data-testid` to the two inputs (`date-range-start`, `date-range-target`).
- Keep the existing container `data-testid="date-range-trigger"` so current
  tests that open the popover keep working; verify no existing test asserts the
  trigger is a `<button>` in a way the change breaks.
- Cover: typing a valid range commits; typing a target before start flags
  invalid and does not commit; grid click still resyncs the text fields; clearing
  a field nulls that endpoint.

## Out of scope

- The native `<input type="date">` in
  [workspace-calendar-panel.tsx:254](../../../components/workspace/workspace-calendar-panel.tsx#L254)
  — different mechanism, not part of this change.
- The dead `DatePopover` export.
- Any minimum-date / no-past-dates rule.
