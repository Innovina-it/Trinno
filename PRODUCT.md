# Product

## Register

product

## Users

Internal team. Operators using the tool inside their daily workflow, not customers being marketed to. Mixed work pattern: kanban triage on a board view AND timeline planning on a roadmap (gantt) view. Same people switch between the two during a session, so the two surfaces must feel like one tool, not two products glued together.

The job to be done: see what is in flight, decide what moves next, schedule when it lands. Decisions per session run in the dozens, not a handful. Every interaction is repeated. Friction compounds.

## Product Purpose

A workspace + boards + roadmap that internal team uses to plan and track work. Trello-shaped kanban for the granular layer (lists, cards, drag, labels, comments, attachments, activity, realtime presence), roadmap (gantt) for the schedule layer (epics, sprints, dependencies, critical path, priority gutter), shared underlying data so a card on the board IS the bar on the roadmap. Success: the team uses it without thinking about it.

## Brand Personality

Clinical, fast, quiet. The tool fades into the background of the work. Voice is terse and direct, never marketing-cheerful, never apologetic. Microcopy reads like a senior operator wrote it for themselves. Confidence through restraint, not through styling.

Three words, in order of priority: **clinical**, **fast**, **quiet**.

## Anti-references

Avoid the visual signature of every mainstream PM tool. The tool should not be confused with any of them on a glance.

- **Trello**: no card-on-blue, no rainbow labels carrying weight, no playful pastels.
- **Asana**: no rainbow status pills, no friendly sans-serif marketing tone, no celebratory animation.
- **Monday**: no candy color blocks, no green-status grids.
- **Jira**: no enterprise-blue chrome, no overstuffed toolbars, no nested side nav.
- **Notion**: no whimsical emoji-as-icon, no Inter-everywhere blandness, no soft gray-on-gray.
- **Linear**: no purple-magenta gradient, no glow effects, no "designed by Apple alumni" sheen as a substitute for personality.

Also banned by category reflex: SaaS-cream backgrounds, "modern startup" gradients, illustrated empty states with cartoon characters, hero-metric dashboards.

## Design Principles

1. **Quiet by default, loud only on user action.** Color, motion, and weight are reserved for the result of a deliberate gesture (drag landing, save, error). Idle UI is mute.
2. **One system, two surfaces.** Board and roadmap share tokens, density, and interaction grammar. A user who learns one knows the other.
3. **Internal-tool ergonomics.** Keyboard parity for every mouse action. Density tolerated over whitespace where data wins. Repeatable actions stay one chord away.
4. **Hierarchy through structure, not decoration.** Primary actions look different from secondary actions through fill, not through extra glow or chrome. If two controls look the same, they should behave the same.
5. **Information first, atmosphere second.** Background, glass, grain, and motion are allowed only when they do not compete with content readability. The first contrast check always wins.

## Accessibility & Inclusion

WCAG 2.2 AA across all interactive surfaces. Honor `prefers-reduced-motion` for the animated mesh, drift, pulse-ring, and any future motion. Priority and status are never encoded by color alone, always paired with shape, label, or position. Focus rings visible against every theme surface. Hit targets ≥32px on primary controls, ≥24px on dense affordances (drag handles, resize edges).
