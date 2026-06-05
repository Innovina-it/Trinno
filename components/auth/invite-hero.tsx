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
type Line = {
  text: string;
  className: string;
  interactive?: boolean;
  // Resend-style white→grey gradient ink, clipped per character.
  ink?: boolean;
  // Wrap the line in the chromatic gradient-border chip (brand-pill).
  pill?: boolean;
};

const LINES: Line[] = [
  {
    text: "Trinno",
    // Editorial serif (Instrument Serif), oversized like the resend.com hero.
    className:
      "font-[family-name:var(--font-instrument)] text-8xl md:text-9xl tracking-tight leading-[0.95]",
    interactive: true,
    ink: true,
  },
  {
    text: "An invite-only service",
    className: "font-sans text-lg font-medium tracking-tight text-fg-muted",
  },
  {
    text: "A service of Innovina.it",
    className: "mono-meta-sm text-fg-muted",
    pill: true,
  },
];

export function InviteHero() {
  // Single running index so the reveal cascades line-to-line, not per-line.
  let charIndex = 0;
  return (
    <div className="text-center space-y-3.5">
      {LINES.map((line, li) => {
        const chars = (
          <span aria-hidden="true">
            {[...line.text].map((ch, ci) => {
              const i = charIndex++;
              const cls = [
                line.interactive ? "ih-char ih-char--hover" : "ih-char",
                line.ink ? "hero-ink" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <span
                  key={ci}
                  className={cls}
                  style={{ "--i": i } as CSSProperties}
                >
                  {ch === " " ? " " : ch}
                </span>
              );
            })}
          </span>
        );
        return (
          <p key={li} className={line.className}>
            <span className="sr-only">{line.text}</span>
            {line.pill ? <span className="brand-pill">{chars}</span> : chars}
          </p>
        );
      })}
    </div>
  );
}
