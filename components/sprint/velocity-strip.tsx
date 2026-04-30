export function VelocityStrip({
  data,
}: {
  data: Array<{ sprintId: string; name: string; pointsCompleted: number }>;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.pointsCompleted), 1);
  const W = 320;
  const H = 80;
  const gap = 6;
  const barW = (W - gap * (data.length - 1)) / data.length;
  const avg = Math.round(
    data.reduce((s, d) => s + d.pointsCompleted, 0) / data.length,
  );
  return (
    <div className="glass rounded-2xl p-4" data-testid="velocity-strip">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="mono-meta">VELOCITY · LAST {data.length}</h3>
        <span className="mono-meta-sm text-fg-muted">AVG {avg}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {data.map((d, i) => {
          const h = (d.pointsCompleted / max) * (H - 12);
          return (
            <g key={d.sprintId}>
              <rect
                x={i * (barW + gap)}
                y={H - h - 12}
                width={barW}
                height={h}
                fill="currentColor"
                opacity="0.7"
                rx="2"
              >
                <title>{`${d.name}: ${d.pointsCompleted} pt`}</title>
              </rect>
              <text
                x={i * (barW + gap) + barW / 2}
                y={H - 2}
                fontSize="9"
                fill="currentColor"
                opacity="0.55"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {d.pointsCompleted}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
