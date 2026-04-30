import type { BurndownPoint } from "@/lib/queries/sprints-stats";

export function BurndownChart({
  total,
  points,
}: {
  total: number;
  points: BurndownPoint[];
}) {
  if (total <= 0 || points.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 text-fg-muted text-sm italic">
        No story points committed yet.
      </div>
    );
  }
  const W = 700;
  const H = 240;
  const M = { l: 36, r: 12, t: 16, b: 28 };
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const yMax = Math.max(total, 1);
  const xPos = (i: number) => M.l + i * stepX;
  const yPos = (v: number) => M.t + innerH - (v / yMax) * innerH;

  const idealPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(i)} ${yPos(p.idealRemaining)}`)
    .join(" ");
  const actualPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(i)} ${yPos(p.pointsRemaining)}`)
    .join(" ");

  return (
    <div
      className="glass rounded-2xl p-4 overflow-x-auto"
      data-testid="burndown-chart"
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="serif-display text-xl">Burndown</h3>
        <span className="mono-meta-sm text-fg-muted">{total} PT TOTAL</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* Y grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <line
            key={i}
            x1={M.l}
            x2={W - M.r}
            y1={M.t + innerH * (1 - f)}
            y2={M.t + innerH * (1 - f)}
            stroke="currentColor"
            strokeOpacity="0.08"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <text
            key={`l${i}`}
            x={M.l - 6}
            y={M.t + innerH * (1 - f) + 3}
            fontSize="10"
            fill="currentColor"
            textAnchor="end"
            opacity="0.55"
            fontFamily="var(--font-mono)"
          >
            {Math.round(yMax * f)}
          </text>
        ))}
        {/* Ideal */}
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeDasharray="4 4"
        />
        {/* Actual */}
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Day ticks + dots */}
        {points.map((p, i) => (
          <g key={p.day}>
            {(i === 0 ||
              i === points.length - 1 ||
              i % Math.max(1, Math.floor(points.length / 6)) === 0) && (
              <text
                x={xPos(i)}
                y={H - 6}
                fontSize="10"
                fill="currentColor"
                opacity="0.55"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {p.day.slice(5)}
              </text>
            )}
            <circle
              cx={xPos(i)}
              cy={yPos(p.pointsRemaining)}
              r="2.5"
              fill="currentColor"
            >
              <title>{`${p.day}: ${p.pointsRemaining} remaining (${p.pointsCompleted} done)`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
