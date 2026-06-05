import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Login-page centerpiece: an auto-playing, monochrome instrument graphic that
 * sits beside the `InviteHero`. Four interchangeable variants exist; the login
 * page picks one at random per request (see `HERO_VARIANT_COUNT`). This is the
 * resend.com-cube *move* — a silent looping object — re-cut for the brand:
 * clinical, quiet, transform/opacity-only, monochrome on near-black.
 *
 * Motion lives entirely in `globals.css` (`.bm-*`, `.wf-*`, `.cp-*`, `.af-*`).
 * The global `prefers-reduced-motion: reduce` block freezes every keyframe to
 * its rest pose; each loop is authored to begin AND end on a clean static
 * frame, so the frozen state still reads as a sensible diagram.
 *
 * This is a Server Component on purpose: no hooks, no client JS. The random
 * pick happens on the (already-dynamic) login page and arrives as a prop, so
 * server and client render the identical variant — no hydration mismatch.
 *
 * Accessibility: the frame is `role="img"` with a descriptive `aria-label`;
 * all inner geometry is `aria-hidden`.
 */

type VariantMeta = {
  caption: string;
  label: string;
  render: () => React.ReactNode;
};

// --- 1 · Board → Roadmap morph ------------------------------------------
// Six card tokens reflow from two stacked kanban columns into horizontal
// gantt bars on a time-grid, then back. States the product thesis literally:
// the card on the board IS the bar on the roadmap.
const BM_TOKENS = [
  { x: 18, y: 24, tx: 46, ty: -10, sx: 1.7857 },
  { x: 158, y: 24, tx: -62, ty: 12, sx: 1.0952 },
  { x: 18, y: 64, tx: 46, ty: -6, sx: 2.2619 },
  { x: 158, y: 64, tx: -18, ty: 16, sx: 0.8333 },
  { x: 18, y: 104, tx: 70, ty: -2, sx: 1.4286 },
  { x: 158, y: 104, tx: -94, ty: 20, sx: 2.0238 },
];

function BoardRoadmapMorph() {
  return (
    <svg
      viewBox="0 0 300 150"
      className="block h-full w-full"
      aria-hidden="true"
    >
      {/* roadmap time-grid — mute on board, lit on schedule */}
      <g className="bm-grid" stroke="var(--hairline)" strokeWidth="1">
        {[64, 96, 128, 160, 192, 224, 256].map((gx) => (
          <line key={gx} x1={gx} y1="8" x2={gx} y2="142" />
        ))}
      </g>
      {/* board column divider — lit on board, mute on schedule */}
      <line
        className="bm-coldiv"
        x1="138"
        y1="18"
        x2="138"
        y2="128"
        stroke="var(--hairline)"
        strokeWidth="1"
      />
      {BM_TOKENS.map((t, i) => (
        <rect
          key={i}
          className="bm-token"
          x={t.x}
          y={t.y}
          width="84"
          height="20"
          rx="3"
          fill="var(--bg-2)"
          stroke="var(--hairline-hi)"
          strokeWidth="1"
          style={
            {
              "--tx": `${t.tx}px`,
              "--ty": `${t.ty}px`,
              "--sx": t.sx,
              "--d": i * 50,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}

// --- 2 · Two-plane wireframe rotate --------------------------------------
// One slab, two layers: a board plane (columns) above a roadmap plane (bars),
// slowly rotating in isometric 3D. "One system, two surfaces" made physical.
function WireframeRotate() {
  return (
    <div className="wf-scene" aria-hidden="true">
      <div className="wf-rotor">
        <div className="wf-plane wf-plane--board" style={{ "--z": "20px" } as CSSProperties} />
        <div className="wf-plane wf-plane--road" style={{ "--z": "-20px" } as CSSProperties}>
          <i className="wf-bar" style={{ top: "20%", left: "10%", width: "62%" }} />
          <i className="wf-bar" style={{ top: "46%", left: "26%", width: "40%" }} />
          <i className="wf-bar" style={{ top: "72%", left: "10%", width: "74%" }} />
        </div>
        <i className="wf-pin" />
      </div>
    </div>
  );
}

// --- 3 · Critical-path trace ---------------------------------------------
// A dependency DAG; a single bright pulse runs the critical route A→C→D→F→G,
// forever. Coldest, most technical read — nods to the roadmap's real feature.
const CP_NODES: Array<[number, number, boolean]> = [
  [24, 75, true], // A
  [96, 32, false], // B
  [96, 118, true], // C
  [168, 75, true], // D
  [240, 40, false], // E
  [240, 110, true], // F
  [282, 75, true], // G
];
const CP_EDGES: Array<[number, number, number, number]> = [
  [24, 75, 96, 32], // A-B
  [24, 75, 96, 118], // A-C
  [96, 32, 168, 75], // B-D
  [96, 118, 168, 75], // C-D
  [168, 75, 240, 40], // D-E
  [168, 75, 240, 110], // D-F
  [240, 40, 282, 75], // E-G
  [240, 110, 282, 75], // F-G
];
const CP_ROUTE = "M24,75 L96,118 L168,75 L240,110 L282,75";

function CriticalPathTrace() {
  return (
    <svg
      viewBox="0 0 300 150"
      className="block h-full w-full"
      aria-hidden="true"
    >
      <g stroke="var(--hairline)" strokeWidth="1" fill="none">
        {CP_EDGES.map((e, i) => (
          <line key={i} x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} />
        ))}
      </g>
      {/* faint full critical route, then the travelling pulse over it */}
      <path d={CP_ROUTE} className="cp-base" />
      <path d={CP_ROUTE} className="cp-pulse" />
      {CP_NODES.map(([cx, cy, crit], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="4"
          fill="var(--bg-deep)"
          stroke={crit ? "var(--fg-faint)" : "var(--hairline-hi)"}
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

// --- 4 · Ambient field ---------------------------------------------------
// No object. A drifting dot-grid with a slow scan line. Maximally "idle UI is
// mute" — the quietest of the four.
function AmbientField() {
  return (
    <div className="af-stage" aria-hidden="true">
      <div className="af-dots" />
      <div className="af-sweep" />
    </div>
  );
}

// --- 5 · Drag-card settle ------------------------------------------------
// The board's signature gesture: a card lifts out of "To Do", arcs across to
// "Doing", and drops with an ease-out-quart overshoot. Static cards keep the
// two columns populated so the frozen (reduced-motion) frame still reads.
function DragCardSettle() {
  const staticCards = [
    { x: 24, y: 30 },
    { x: 24, y: 58 }, // To Do column (above the dragged card's origin)
    { x: 172, y: 58 },
    { x: 172, y: 86 }, // Doing column
  ];
  return (
    <svg
      viewBox="0 0 300 150"
      className="block h-full w-full"
      aria-hidden="true"
    >
      {/* column divider + list-title ticks */}
      <line x1="150" y1="14" x2="150" y2="136" stroke="var(--hairline)" strokeWidth="1" />
      <rect x="24" y="12" width="60" height="7" rx="2" fill="var(--hairline-hi)" />
      <rect x="172" y="12" width="60" height="7" rx="2" fill="var(--hairline-hi)" />
      {staticCards.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width="104"
          height="22"
          rx="3"
          fill="var(--bg-2)"
          stroke="var(--hairline-hi)"
          strokeWidth="1"
        />
      ))}
      {/* the dragged card: origin = bottom of To Do, target = top of Doing */}
      <rect
        className="dc-card"
        x="24"
        y="86"
        width="104"
        height="22"
        rx="3"
        fill="var(--bg-3)"
        stroke="var(--fg)"
        strokeWidth="1.25"
      />
    </svg>
  );
}

// --- 6 · Sprint burndown -------------------------------------------------
// The iconic chart: a static ideal line, then the actual step-line draws
// toward zero with its area filling in. Rests on the complete chart.
const BD_ACTUAL =
  "M30,24 L72,24 L72,48 L114,48 L114,70 L156,70 L156,92 L198,92 L198,104 L240,104 L240,126 L270,126";
const BD_AREA =
  "M30,126 L30,24 L72,24 L72,48 L114,48 L114,70 L156,70 L156,92 L198,92 L198,104 L240,104 L240,126 Z";

function SprintBurndown() {
  return (
    <svg
      viewBox="0 0 300 150"
      className="block h-full w-full"
      aria-hidden="true"
    >
      {/* sprint gridlines */}
      <g stroke="var(--hairline)" strokeWidth="1">
        {[72, 114, 156, 198, 240].map((gx) => (
          <line key={gx} x1={gx} y1="20" x2={gx} y2="126" />
        ))}
      </g>
      {/* axes */}
      <path d="M30,18 L30,126 L276,126" fill="none" stroke="var(--hairline-hi)" strokeWidth="1.25" />
      {/* ideal reference */}
      <line x1="30" y1="24" x2="270" y2="126" stroke="var(--fg-faint)" strokeWidth="1.5" strokeDasharray="3 4" />
      {/* actual: filled area then the drawing step-line over it */}
      <path className="bd-area" d={BD_AREA} fill="var(--fg)" />
      <path
        className="bd-actual"
        d={BD_ACTUAL}
        fill="none"
        stroke="var(--fg)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- 7 · Status-texture cycle --------------------------------------------
// One card cycles its treatment through the four statuses, reusing the status
// visual language from DESIGN.md (rendered monochrome): todo (plain) → in
// progress (pulsing inset ring) → review (45° stripes) → done (hatches). The
// card surface is the always-on base, so the frozen frame is a plain card.
const SC_PHASES = ["TODO", "DOING", "REVIEW", "DONE"];

function StatusCycle() {
  return (
    <div className="sc-stage" aria-hidden="true">
      <div className="sc-card">
        <i className="sc-dot" />
        <span className="sc-layer sc-prog">
          <i className="sc-ring" />
        </span>
        <span className="sc-layer sc-review" />
        <span className="sc-layer sc-done" />
        {SC_PHASES.map((p, i) => (
          <span key={p} className={`sc-label sc-label--${i}`}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

const VARIANTS: VariantMeta[] = [
  {
    caption: "BOARD ⇄ ROADMAP",
    label:
      "Animated diagram: kanban cards reflowing into a roadmap timeline and back.",
    render: BoardRoadmapMorph,
  },
  {
    caption: "ONE SYSTEM · TWO SURFACES",
    label:
      "Animated diagram: a board plane and a roadmap plane rotating as one object.",
    render: WireframeRotate,
  },
  {
    caption: "CRITICAL PATH",
    label:
      "Animated diagram: a pulse tracing the critical path through a dependency graph.",
    render: CriticalPathTrace,
  },
  {
    caption: "IDLE",
    label: "Animated ambient dot-field with a slow scan line.",
    render: AmbientField,
  },
  {
    caption: "BOARD · DRAG",
    label:
      "Animated diagram: a card dragged from one board column into the next.",
    render: DragCardSettle,
  },
  {
    caption: "SPRINT BURNDOWN",
    label: "Animated diagram: a sprint burndown chart drawing toward zero.",
    render: SprintBurndown,
  },
  {
    caption: "STATUS · TODO→DONE",
    label:
      "Animated diagram: a card cycling through todo, in progress, review, and done states.",
    render: StatusCycle,
  },
];

/** Number of hero animations — drives the per-load random pick on the login
 *  page. Derived so adding a VARIANTS entry expands the pool automatically. */
export const HERO_VARIANT_COUNT = VARIANTS.length;

export function HeroAnimation({
  variant,
  frameClassName = "max-w-sm",
}: {
  variant: number;
  /** Sizing override for the viewport frame (e.g. wider when used as an
   *  overlay layer). Merged over the default `max-w-sm`. */
  frameClassName?: string;
}) {
  const v = VARIANTS[((variant % HERO_VARIANT_COUNT) + HERO_VARIANT_COUNT) % HERO_VARIANT_COUNT];
  return (
    <div
      role="img"
      aria-label={v.label}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-hairline bg-[color:var(--bg-1)]/30 shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset] aspect-[300/150]",
        frameClassName,
      )}
    >
      <span className="mono-meta-sm pointer-events-none absolute left-3 top-2 z-10 text-fg-faint">
        {v.caption}
      </span>
      {v.render()}
    </div>
  );
}
