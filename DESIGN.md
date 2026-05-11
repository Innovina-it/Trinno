---
name: Trello Foundation
description: Internal kanban + roadmap workspace, monochrome and quiet by default.
colors:
  bg-deep: "#0a0a0a"
  bg-1: "#141414"
  bg-2: "#1a1a1a"
  bg-3: "#202020"
  popover: "#1f1f1f"
  fg: "#fafafa"
  fg-muted: "#fafafa99"
  fg-faint: "#fafafa59"
  surface: "#ffffff0d"
  surface-strong: "#ffffff16"
  surface-hi: "#ffffff1a"
  hairline: "#ffffff1f"
  hairline-hi: "#ffffff38"
  status-todo: "#94a3b8"
  status-in-progress: "#f59e0b"
  status-review: "#38bdf8"
  status-done: "#22c55e"
  status-blocked: "#fb7185"
  signal-cyan: "#00e5ff"
  signal-magenta: "#ff2bd6"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.08em"
  serif-italic:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  "2xl": "20px"
  "3xl": "24px"
  "4xl": "32px"
  pill: "9999px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg-deep}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "#fafafaeb"
    textColor: "{colors.bg-deep}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.body}"
  button-outline-hover:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.fg}"
  button-secondary:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.body}"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
    padding: "4px 14px"
    height: "40px"
    typography: "{typography.body}"
  chip:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.label}"
  card-glass:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
    padding: "12px"
  popover-surface:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
    padding: "6px"
  list-column:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.2xl}"
    padding: "10px"
    width: "320px"
---

# Design System: Trello Foundation

## 1. Overview

**Creative North Star: "The Studio Console"**

A dimly lit studio console for an internal team. Black surfaces, white ink, no decoration that does not earn its keep. The tool fades into the background of the work; what remains visible is the work itself. Color is reserved for status (the workflow needs a signal) and for the result of a deliberate gesture (a save lands, a drag commits, an error fires). Everything else is grayscale by doctrine.

The system is monochrome by default, not by accident. Card titles, labels, lists, columns, sidebars, headers: all white-on-near-black. The five accent colors that historically existed in the codebase (cyan, magenta, violet, lime, amber) are flattened to white in idle UI. They are kept as named tokens so they can be summoned for specific high-information surfaces (focus glow rings, charts, drag-source previews) without polluting the everyday palette. The palette is exactly two ideas: ink and surface.

This explicitly rejects every PM-tool visual reflex listed in PRODUCT.md. No Trello blue. No Asana rainbow. No Monday candy blocks. No Jira enterprise chrome. No Notion soft-gray-on-gray. No Linear purple-magenta sheen. No SaaS-cream backgrounds. No "modern startup" gradients. No illustrated empty states. No hero-metric dashboards.

**Key Characteristics:**
- Black-and-white discipline: any color in idle UI is a bug, not a feature.
- Glass is structural, not decorative: surfaces are translucent only when they overlay other content (cards, list columns, glass-strong dialogs); floating popovers, banners, and menus are opaque so text always reads.
- Density tolerated: row heights tight, label text 11px mono, monospaced metadata everywhere.
- Status colors are the only sanctioned chroma: five workflow tokens (todo, in-progress, review, done, blocked) plus five priority dots (red-400, orange-400, yellow-300, fg/50, fg/30). Used as 4px stripes or 2px dots, never as fills behind text.
- Hierarchy is structural: filled white pill = primary, glass pill = secondary, ghost = tertiary. No glow, no shadow tier shouting.

## 2. Colors

A monochrome palette tinted toward warm-neutral black, with status colors as the only sanctioned chroma.

### Primary

The foreground itself is the primary surface. White (`#fafafa`) on near-black (`#0a0a0a`) carries every interactive promotion: filled buttons, primary CTAs, focus rings, the active drag-handle dot. Contrast ratio is 18.9:1 against the deepest background.

- **Primary Ink** (`#fafafa`, `oklch(98.5% 0 0)`): every primary action's fill. Reads as a confident solid white in the studio. Used as `--fg`.
- **Primary Surface** (`#0a0a0a`, `oklch(8% 0 0)`): the body floor. Used as `--bg-deep`. Not pure black on purpose; the 8% lightness lets a faint white wash and grain sit on top without banding.

### Neutral

Five-step background ladder + three foreground tiers + four surface tints + two hairlines. Every step earns its place.

- **Floor** (`#0a0a0a`): body background, drag canvas, deepest surface. `--bg-deep`.
- **Layer 1** (`#141414`): sidebars, sticky nav backgrounds. `--bg-1`. +1.16 contrast vs floor.
- **Layer 2** (`#1a1a1a`): muted panels, table headers. `--bg-2`. +1.31 vs floor.
- **Layer 3** (`#202020`): pressed states, internal scroll backdrops. `--bg-3`. +1.49 vs floor.
- **Popover Lift** (`#1f1f1f`): all floating opaque surfaces (dropdowns, menus, banners). `--popover`. Solid by doctrine, never translucent.
- **Foreground** (`#fafafa`): primary text, headings, primary action ink. `--fg`. 18.9:1.
- **Foreground Muted** (`#fafafa` at 60% alpha): secondary text, label dt, inactive icon. `--fg-muted`. 11.7:1.
- **Foreground Faint** (`#fafafa` at 35% alpha): metadata, timestamps, placeholders. `--fg-faint`. 7.3:1.
- **Surface** (`#ffffff` at 5% alpha): translucent panel fill for in-page glass (cards, list columns). `--surface`. Reads as a faint lift over body bg.
- **Surface Strong** (`#ffffff` at 8.5% alpha): hover state, active row, secondary button rest. `--surface-strong`.
- **Surface Hi** (`#ffffff` at 10% alpha): tertiary lift, list drop-target, command palette active item. `--surface-hi`.
- **Hairline** (`#ffffff` at 12% alpha): default border, divider, hairline rule. `--hairline`. WCAG 1.4.11-passing 3.05:1.
- **Hairline Hi** (`#ffffff` at 22% alpha): focus-friendly border, dashed outlines, popover frames. `--hairline-hi`. 4.4:1.

### Tertiary: Status (the only sanctioned chroma)

Five workflow tokens. Used at 100% saturation only inside `<StatusKindBadge>`, list `status_kind` swatches, and Gantt cell fills. Never bled across a row, never used as a card fill behind text.

- **Status Todo** (`#94a3b8`): untriaged neutral.
- **Status In Progress** (`#f59e0b`): work in flight, amber.
- **Status Review** (`#38bdf8`): waiting on review, sky.
- **Status Done** (`#22c55e`): closed, emerald.
- **Status Blocked** (`#fb7185`): blocked dependency, rose-400. Picked deliberately less saturated than rose-500 to avoid vibration on near-black.

#### Roadmap Bar Patterns

Status fills on roadmap bars carry an additional texture so the operator can read state without color (color-blind safe + reduced-saturation legible). The texture is **not** decoration; each value carries documented meaning. The legend lives in the shortcuts overlay on the roadmap (`?` to open).

- **Todo**: solid fill at 22% of `--status-todo`. No texture.
- **In Progress**: solid fill at 38% of `--status-in-progress` + a 1px inset ring at 55% + pulse animation. The pulse is the texture; it stops under `prefers-reduced-motion`.
- **Review**: 45° diagonal stripes (`repeating-linear-gradient(45deg, ...)` at 4px/8px) over a 22% `--status-review` base. The stripes mean "waiting on a human". Hover reveals the reviewer.
- **Done**: horizontal hatches (`repeating-linear-gradient(0deg, ...)` at 2px/6px) over a 22% `--status-done` base. Hatches mean "closed and frozen"; ressembles a finished ledger.
- **Blocked**: solid fill at 12–18% of `--status-blocked` + a 2px inset ring at 60%. Ring is the texture; the bar reads "fenced off".

The patterns are constants — do not introduce a sixth status texture without updating this section and the legend in `components/shortcuts-overlay.tsx`.

### Tertiary: Priority Dots

Five dot tokens for `P0` to `P4`, used as 4px left-edge stripes inside the priority gutter and as 2px dots inside priority chips. Never as background fills.

- **P0 Red** (`#f87171`): critical.
- **P1 Orange** (`#fb923c`): high.
- **P2 Yellow** (`#fde047`): medium.
- **P3 White-50** (`#fafafa` at 50% alpha): low.
- **P4 White-30** (`#fafafa` at 30% alpha): trivial.

### Latent: Signal Accents

Defined in tokens but suppressed to white in idle UI. Reserved for one-off, high-information moments where chroma earns its place: focus rings on inputs (cyan glow), invalid-state ring on inputs (magenta), drag preview halo, future chart fills.

- **Signal Cyan** (`#00e5ff`): focus glow on `Input` (3px outer glow at 20% alpha).
- **Signal Magenta** (`#ff2bd6`): invalid state, selection background at 22%.

### Named Rules

**The Idle Mute Rule.** Idle UI is grayscale. If a screen is at rest and it carries a saturated color anywhere outside a status pill or a priority dot, that color is wrong. Color is feedback, not decoration.

**The Hairline Rule.** Borders and dividers default to `--hairline` (`#ffffff1f`, 3.05:1). Never below; that fails WCAG 1.4.11 for non-text UI.

**The Solid Popover Rule.** Floating panels (dropdown menus, popovers, banners, tooltips, the bulk action bar) are opaque (`--popover`, `#1f1f1f`). Translucent glass on a floating panel masks the content beneath; we forbid it.

## 3. Typography

**Display Font:** Geist (with `ui-sans-serif`, system fallback)
**Body Font:** Geist (same family, regular weight)
**Label / Mono Font:** Geist Mono (with JetBrains Mono fallback for code-like surfaces)
**Italic / Placeholder Accent:** Instrument Serif

**Character:** A single neutral grotesque carries display, headline, and body, with weight contrast doing the hierarchy work. The mono carries every machine-fact (IDs, dates, ordinals, status labels) in 11px uppercase with 0.08em tracking, so a glance distinguishes "human content" from "system metadata" instantly. Italic Instrument Serif appears only in placeholder text inside form controls, an editorial wink against the otherwise mechanical voice.

### Hierarchy

- **Display** (`800`, `clamp(1.75rem, 3.5vw, 2.5rem)`, `0.95` line-height, `-0.035em` tracking): hero h1, modal titles, empty-state pull-quotes. Implemented as the `serif-display` utility (the name is legacy; the font is sans).
- **Headline** (`700`, `1.25rem`, `1.15` line-height, `-0.02em` tracking): page section headers, board title, sprint header.
- **Title** (`600`, `0.95rem`, `1.3` line-height, `-0.005em` tracking): card titles, list column titles, dialog headings.
- **Body** (`400`, `0.875rem`, `1.5` line-height): card descriptions, comments, paragraph text. Cap line length at 65 to 75ch in long-form surfaces (card description, comments).
- **Label / Mono Meta** (`500`, `0.6875rem`, `0.08em` tracking, uppercase): IDs (`#WP1.1`), dates, status pills, list ordinals, mono-meta-sm at `0.625rem` with `0.1em` tracking.
- **Serif Italic Placeholder** (`400`, `0.875rem`, italic): only for `placeholder` text inside `Input`, `Textarea`, search field. Never used as body type.

### Named Rules

**The Mono-Meta Rule.** Every machine-generated label (IDs, ISO dates, ordinals, ENUM values like `IN PROGRESS`) is mono, 11px or 10px, uppercase, 0.08em+ tracking. Human content is sans, sentence case. The reader's eye learns the split inside one screen.

**The One-Family Rule.** Display, headline, title, body all share Geist. Hierarchy is weight + size + tracking, not a different face. The two non-Geist typefaces (Geist Mono, Instrument Serif) carry strict roles defined above; do not introduce a fourth family.

## 4. Elevation

The system is mostly flat, with three deliberate elevation modes layered on top.

1. **Tonal layering** is the default. Depth comes from the bg-deep -> bg-1 -> bg-2 -> bg-3 ladder and the surface-* alpha tints, not from shadows.
2. **Glass surfaces** (`glass`, `glass-strong`, `glass-hi`) carry depth on translucent panels with backdrop-filter blur (24-28px) plus a 1px inner highlight and a deep ambient drop shadow (`0 32px 80px -32px rgb(0 0 0 / 0.5)`). Used on cards, list columns, dialogs, and the sticky board masthead.
3. **Drag and focus halos** are the only chromatic shadows. The drag-active utility carries a 1px white outline + a 4px outer halo at 10% alpha; cyan focus glow on `Input` is `0 0 0 3px rgb(0 229 255 / 0.20)`.

### Shadow Vocabulary

- **Card Inset Highlight** (`0 1px 0 0 rgb(255 255 255 / 0.06) inset`): every glass surface carries this so its top edge reads as a lit lip in 3D.
- **Card Ambient Drop** (`0 12px 30px -16px rgb(0 0 0 / 0.5)`): glass card resting state.
- **Glass-Strong Drop** (`0 40px 100px -32px rgb(0 0 0 / 0.6)`): dialogs and modals.
- **Drag Halo** (`0 0 0 1px rgb(255 255 255 / 0.55), 0 24px 50px -12px rgb(0 0 0 / 0.7), 0 0 0 4px rgb(255 255 255 / 0.10)`): the dragged card / bar lifts off the canvas with a luminous outline.
- **Cyan Focus Ring** (`0 0 0 3px rgb(0 229 255 / 0.20), inset 0 1px 0 0 rgb(255 255 255 / 0.08)`): `Input` focus.
- **Magenta Invalid Ring** (`0 0 0 3px rgb(255 43 214 / 0.25)`): `Input[aria-invalid]`.

### Named Rules

**The Flat-At-Rest Rule.** Surfaces are flat at rest. Shadows appear only on lifted elements (glass cards, dialogs) and on response-to-state (drag, focus). Never as decoration.

**The Glass-Is-Structural Rule.** `glass`, `glass-strong`, `glass-hi` are reserved for surfaces that overlay content underneath: a card on a list, a list column on a board canvas, a dialog on a page. They are forbidden as decorative atmosphere on full-bleed sections, hero panels, or anything that does not literally float above other content.

## 5. Components

### Buttons

- **Shape:** pill (`rounded-full`, 9999px). Icon variants are also pills (`size-9`, etc.).
- **Primary** (`shimmer-cta`): background `--fg` (`#fafafa`), text `--bg-deep` (`#0a0a0a`), inset 1px white highlight, 8px ambient drop. Hover shifts background to `#fafafaeb`. Active translates +1px Y. Used on the single primary CTA per surface (e.g. New Card, Save).
- **Outline** (`glass`): translucent surface, hairline border, hover bumps to `--surface-strong` and `--hairline-hi`. Most action chips and toolbar selectors.
- **Secondary**: opaque-ish glass with hairline. Used on dialog footer cancel buttons, tertiary commits.
- **Ghost**: no background at rest, text in `--fg-muted`. On hover background lifts to `--surface`, text to `--fg`. For toolbar verbs that should sit quiet.
- **Destructive**: hairline glass tinted slightly stronger; no chroma. Hover lifts to 10% white. Reserved for delete and discard.
- **Link**: underlined, `text-fg`, decoration `--hairline-hi` -> `--fg` on hover.

**Sizes:** xs (28px h), sm (32px h), default (36px h), lg (44px h), plus icon variants. Default text is `0.875rem`, `font-medium`. xs/sm/lg use uppercase + 0.08em tracking + smaller font.

**Focus:** `focus-visible:ring-1 focus-visible:ring-fg/40`. No 2px outline; the ring is 1px white at 40%.

### Inputs

- **Shape:** `rounded-xl` (16px). Height `40px` (`h-10`).
- **Background:** `--surface`, hairline border.
- **Hover:** border lifts to `--hairline-hi`.
- **Focus:** border switches to `--accent-cyan` at 60% + outer cyan glow `0 0 0 3px rgb(0 229 255 / 0.20)` + inner highlight. Background lifts to `--surface-strong`. The cyan is the one place chroma escapes the monochrome rule, gated by user gesture (the input was clicked).
- **Placeholder:** italic Instrument Serif at `--fg-faint`.
- **Invalid (`aria-invalid`):** border + text shift to `--accent-magenta` at 60%, glow becomes magenta.

### Chips

The workhorse small affordance. Used for filters, type badges, mono-meta labels, status pills.

- **Shape:** pill, `padding: 2px 8px`.
- **Default:** `--surface-strong` background, `--fg-muted` text, hairline border, mono 11px uppercase.
- **Active / Selected:** `bg-fg/10`, `ring-1 ring-fg/40`, text shifts to `--fg`.
- **Type chips** (Epic, Story, Task, Subtask, Bug): each carries an icon (Mountain, BookOpen, Square, Bug) tinted by type (violet, emerald, neutral, rose). Type tint applies to icon + selected ring, not to the chip background.

### Cards (glass)

- **Shape:** `rounded-xl` (16px).
- **Background:** `--surface-strong` with `backdrop-blur-md`, hairline border.
- **Shadow:** card inset highlight + card ambient drop. Hover lifts the card 0.5px Y, swaps to `--surface-hi`, border to `--hairline-hi`, deeper drop.
- **Selected:** `ring-2 ring-[--accent-cyan]` + `--surface-hi`. The cyan is permitted because selection is a user gesture.
- **Drag state:** rotates `2deg`, scales `1.02`, drag halo replaces the rest shadow.
- **Internal padding:** 10px (compact) or 12px (default).

### List Columns / Lane Panels

- **Shape:** `rounded-2xl` (20px).
- **Background:** `glass` (`--surface` + 24px backdrop blur).
- **Width:** 320px (`w-80`).
- **Drop target:** background lifts to `--surface-strong` while a drag hovers.
- **Header:** title in `title` weight, ordinal stamp in `mono-meta-sm` at `--fg-faint`.

### Popover / Dropdown / Menu

- **Shape:** `rounded-2xl` (20px), opaque `--popover` (`#1f1f1f`).
- **Border:** `--hairline-hi`.
- **Shadow:** glass-strong drop (`0 40px 100px -32px ...`).
- **No backdrop blur on opaque popovers.** The blur exists in the `glass-hi` utility for legacy callers but the rule is solid background, no translucency over content.
- **Item rest:** `--fg-muted`, hover `--fg` on `--surface-hi`.

### Roadmap Bar

The system's signature component. A 28px-tall absolute-positioned pill on the gantt canvas representing one card.

- **Fill:** tonal grayscale band keyed by status (`status-fill` ramps).
- **Border:** 1px white at 30%, hover 60%.
- **Priority stripe:** 3px left-edge stripe in priority dot color (`P0` red, `P1` orange, etc.). Always rendered when priority is set, regardless of priority gutter visibility.
- **Hover tooltip:** opaque popover surface (`--popover`), hairline-hi border, shadow-xl. 64px wide, anchored top-full center. Bar lifts to `z-30` while hover or context menu is open so tooltip never sits beneath neighbor bars.
- **Resize handles:** invisible 12px hot zones at the left and right edges, chevron icon revealed on hover.
- **Drag state:** drag halo, rotates 2deg.

### Priority Gutter

Five vertical bands stacked along a 64px column to the left of the lane label panel. Each band:

- **Background:** neutral `--bg-1` (no colored wash).
- **4px left stripe:** priority dot color (the only color visible on the gutter at rest).
- **Centered label:** `Flag` icon + `P0` to `P4` in mono-meta-sm, `--fg-muted`.
- **Hover (drag-target):** background lifts to `--surface-strong`, ring `1px ring-fg/40 ring-inset`.

### Top Nav

- **Shape:** flat strip, no rounded corners, `--bg-1` background, hairline-bottom rule.
- **Height:** 56px (`h-14`).
- **Workspace switcher:** ghost button + chevron, shows workspace name in `title` weight.
- **Account avatar:** 32px circle with the user's initials in `mono-meta`. Hover scales 1.05.

## 6. Do's and Don'ts

### Do:

- **Do** keep idle UI grayscale. If a saturated color is on screen with the user not actively interacting with anything, that color is wrong. The Idle Mute Rule.
- **Do** use `--popover` (`#1f1f1f`) opaque for every floating panel: dropdowns, banners, tooltips, the bulk action bar, sonner toasts. The Solid Popover Rule.
- **Do** lift glass cards with `glass`, `glass-strong`, or `glass-hi` only when they literally float above other content. The Glass-Is-Structural Rule.
- **Do** carry every machine-fact in mono 10-11px uppercase with 0.08em+ tracking. IDs, dates, ordinals, status. The Mono-Meta Rule.
- **Do** use status colors (`--status-todo`, `--status-in-progress`, `--status-review`, `--status-done`, `--status-blocked`) only inside status pills, list `status_kind` swatches, and Gantt cell fills. Never as a card-row background.
- **Do** carry priority as a 4px left-edge stripe (gutter band) or a 2px dot inside a chip. Never as a row fill.
- **Do** pair every status / priority signal with a non-color cue (label, position, shape) so reduced-color and color-blind users get parity.
- **Do** honor `prefers-reduced-motion`: kill the `mesh-drift`, `pulse-ring`, and `float-soft` animations to a static state.
- **Do** keep border thickness at 1px. Hairlines at `--hairline` (12% white) by default, `--hairline-hi` (22%) for emphasis.
- **Do** keep hit targets at >= 32px on primary controls and >= 24px on dense affordances (drag handles, resize edges).

### Don't:

- **Don't** use Trello card-on-blue, Asana rainbow status pills, Monday candy blocks, Jira enterprise blue, Notion soft gray-on-gray, or the Linear purple-magenta gradient. Each anti-reference in PRODUCT.md is forbidden by name.
- **Don't** use side-stripe borders (`border-left` or `border-right` >1px as a colored accent) on cards, alerts, callouts, or list items. The 3px priority stripe on roadmap bars is the one exception, and only because the bar is itself a stripe.
- **Don't** use gradient text (`background-clip: text` over a gradient). The `gradient-text` utility exists in `globals.css` for legacy reasons; new code may not invoke it.
- **Don't** use glassmorphism as decoration. Glass surfaces overlay other content or they do not exist.
- **Don't** ship a hero-metric dashboard (big number + small label + supporting stats + accent). The Dashboards page does not get a SaaS dashboard treatment.
- **Don't** use the same chip class for both buttons and state pills. State pills have no border ring; action chips have `--hairline`.
- **Don't** introduce a fourth typeface. Geist + Geist Mono + Instrument Serif. Stop.
- **Don't** colorize a row, lane, or column to indicate priority. Priority is an icon + a 4px stripe. Always.
- **Don't** use border radius below `--radius-sm` (8px) on any container surface. The 4px and 6px radii are reserved for stripes and inline tags.
- **Don't** animate CSS layout properties (`width`, `height`, `top`, `left`). Use `transform` and `opacity` only. Ease out on `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quart) or sharper.
- **Don't** use em dashes anywhere in UI copy. Replace with commas, colons, semicolons, periods, parentheses.
- **Don't** wrap floating action chrome in glass. The undo banner, bulk action bar, error pane, and sonner toaster all use opaque popover surfaces.
