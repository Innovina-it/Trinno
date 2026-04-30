import Link from "next/link";
import { boardCode } from "@/lib/format";

export type BoardTile = {
  id: string;
  title: string;
  backgroundKind: string;
  backgroundValue: string;
  archived: boolean;
};

function tintFromBoard(b: BoardTile): string {
  return b.backgroundKind === "color" ? b.backgroundValue : "#8b5cf6";
}

// Hex → rgb tuple, used to derive translucent variants for the per-tile glow
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(v, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function tileBackground(color: string): string {
  // Layered: deep glass + colored wash from the board's chosen color
  const [r, g, b] = hexToRgb(color);
  return `linear-gradient(135deg, rgb(${r} ${g} ${b} / 0.32) 0%, rgb(${r} ${g} ${b} / 0.08) 60%, rgb(255 255 255 / 0.04) 100%)`;
}

function tileGlow(color: string): string {
  const [r, g, b] = hexToRgb(color);
  return `0 1px 0 0 rgb(255 255 255 / 0.10) inset, 0 18px 50px -16px rgb(${r} ${g} ${b} / 0.45), 0 0 0 1px rgb(${r} ${g} ${b} / 0.20)`;
}

export function BoardGrid({ boards }: { boards: BoardTile[] }) {
  const visible = boards.filter((b) => !b.archived);

  if (visible.length === 0) {
    return (
      <div className="glass-strong noise-overlay rounded-3xl px-6 py-24 text-center">
        <p className="serif-display text-5xl md:text-6xl gradient-text italic">
          &ldquo;No boards yet.&rdquo;
        </p>
        <p className="mono-meta mt-6 text-fg-muted max-w-sm mx-auto">
          Boards keep projects, lists, and cards in print. Draft your first one
          using the New board button up top.
        </p>
      </div>
    );
  }

  return (
    <ul
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      style={{ perspective: "1200px" }}
    >
      {visible.map((b, i) => {
        const tint = tintFromBoard(b);
        return (
          <li key={b.id} className="[transform-style:preserve-3d]">
            <Link
              href={`/b/${b.id}`}
              data-board-id={b.id}
              className="group/board relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl p-5 backdrop-blur-xl border border-[color:var(--hairline)] transition-all duration-300 ease-out hover:-translate-y-1 hover:[transform:translateY(-4px)_rotateX(2deg)] hover:border-[color:var(--hairline-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-cyan)]/60"
              style={{
                background: tileBackground(tint),
                boxShadow: tileGlow(tint),
              }}
            >
              {/* Top strip: index + ID badge */}
              <div className="flex items-baseline justify-between gap-2">
                <span className="mono-meta-sm text-fg-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="chip">#{boardCode(b.id)}</span>
              </div>

              {/* Center: serif italic board title */}
              <h2 className="serif-display text-3xl md:text-4xl text-fg leading-tight">
                <span className="relative inline-block pr-1">
                  <span className="transition-all duration-300 group-hover/board:gradient-text">
                    {b.title}
                  </span>
                  {/* Gradient underline grows on hover */}
                  <span
                    aria-hidden
                    className="absolute left-0 right-2 -bottom-1 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-accent-cyan via-accent-magenta to-accent-violet transition-transform duration-300 ease-out group-hover/board:scale-x-100"
                  />
                </span>
              </h2>

              {/* Bottom strip: color swatch + open chevron */}
              <div className="flex items-end justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="block size-3 rounded-full"
                    style={{
                      backgroundColor: tint,
                      boxShadow: `0 0 12px ${tint}`,
                    }}
                  />
                  <span className="mono-meta-sm text-fg-faint">SWATCH</span>
                </span>
                <span className="mono-meta-sm text-fg-muted transition-all duration-200 group-hover/board:gradient-text-static group-hover/board:translate-x-0.5">
                  OPEN &rarr;
                </span>
              </div>

              {/* Sheen highlight — diagonal gradient sweep */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover/board:opacity-100"
                style={{
                  background:
                    "linear-gradient(135deg, rgb(255 255 255 / 0.10) 0%, transparent 40%)",
                }}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
