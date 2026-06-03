import type { CSSProperties } from "react";

/**
 * Login-page hero: three centered lines with a per-character entrance.
 *
 * Motion (pure CSS, no client JS — see `.ih-char` in globals.css):
 *   - every character across all three lines fades + rises in a downward
 *     cascade on load (staggered by a global index);
 *   - afterwards the title is static but hover-reactive: the character under
 *     the cursor lifts and its immediate neighbours ease up a touch.
 *
 * Accessibility: the real text is exposed once via an `sr-only` span; the
 * animated per-character spans are `aria-hidden` so screen readers read
 * "Trinno", not "T r i n n o". Under `prefers-reduced-motion: reduce` the
 * characters render static (globals.css).
 */
type Line = { text: string; className: string; interactive?: boolean };

const LINES: Line[] = [
  {
    text: "Trinno",
    className: "font-sans text-5xl font-bold tracking-tight text-fg",
    interactive: true,
  },
  {
    text: "An invite-only service",
    className: "font-sans text-lg font-medium tracking-tight text-fg-muted",
  },
  {
    text: "A service of Innovina.it",
    className: "mono-meta-sm text-fg-faint",
  },
];

export function InviteHero() {
  // Single running index so the reveal cascades line-to-line, not per-line.
  let charIndex = 0;
  return (
    <div className="text-center space-y-2.5">
      {LINES.map((line, li) => (
        <p key={li} className={line.className}>
          <span className="sr-only">{line.text}</span>
          <span aria-hidden="true">
            {[...line.text].map((ch, ci) => {
              const i = charIndex++;
              return (
                <span
                  key={ci}
                  className={
                    line.interactive ? "ih-char ih-char--hover" : "ih-char"
                  }
                  style={{ "--i": i } as CSSProperties}
                >
                  {ch === " " ? " " : ch}
                </span>
              );
            })}
          </span>
        </p>
      ))}
    </div>
  );
}
