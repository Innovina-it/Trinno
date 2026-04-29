import Link from "next/link";
import { boardCode } from "@/lib/format";

export type BoardTile = {
  id: string;
  title: string;
  backgroundKind: string;
  backgroundValue: string;
  archived: boolean;
};

// Treat the user's chosen color as a 12% editorial tint laid over paper —
// so boards on the index card grid feel cataloged rather than full-bleed.
function tintFromBoard(b: BoardTile): string {
  return b.backgroundKind === "color" ? b.backgroundValue : "#0079bf";
}

function tintBackground(color: string): string {
  return `linear-gradient(${color}1f, ${color}1f), var(--paper)`;
}

export function BoardGrid({ boards }: { boards: BoardTile[] }) {
  const visible = boards.filter((b) => !b.archived);

  if (visible.length === 0) {
    return (
      <div className="border border-rule paper-grid px-6 py-24 text-center">
        <p className="pull-quote text-5xl md:text-6xl text-ink/85">
          &ldquo;No boards yet.&rdquo;
        </p>
        <p className="mono-meta mt-6 text-ink/50 max-w-sm mx-auto">
          Boards keep projects, lists, and cards in print. Draft your first one
          using the New board button up top.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-3 border border-rule">
      {visible.map((b, i) => {
        const tint = tintFromBoard(b);
        return (
          <li key={b.id} className="bg-paper">
            <Link
              href={`/b/${b.id}`}
              data-board-id={b.id}
              className="group/board relative flex h-44 flex-col justify-between p-5 transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
              style={{ background: tintBackground(tint) }}
            >
              {/* Top strip: index number + ID */}
              <div className="flex items-baseline justify-between gap-2">
                <span className="mono-meta-sm text-ink/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mono-meta-sm text-ink/55">
                  #{boardCode(b.id)}
                </span>
              </div>

              {/* Center: serif italic board title */}
              <h2 className="serif-display text-3xl md:text-4xl text-ink leading-tight">
                <span className="relative inline pr-1">
                  {b.title}
                  {/* Hairline signal-orange underline that grows on hover */}
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 -bottom-0.5 h-px origin-left scale-x-0 bg-signal transition-transform duration-200 ease-out group-hover/board:scale-x-100"
                  />
                </span>
              </h2>

              {/* Bottom strip: color swatch + open chevron */}
              <div className="flex items-end justify-between gap-2">
                <span
                  aria-hidden
                  className="block h-1 w-8"
                  style={{ backgroundColor: tint }}
                />
                <span className="mono-meta-sm text-ink/40 transition-colors duration-150 group-hover/board:text-signal">
                  OPEN &rarr;
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
