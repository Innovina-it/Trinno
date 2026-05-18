const TYPE_ORDER = ["story", "task", "subtask", "bug"] as const;

export function GadgetCardsByType({
  data,
}: {
  data: Record<string, number>;
}) {
  const total = TYPE_ORDER.reduce((s, t) => s + (data[t] ?? 0), 0);
  if (total === 0) {
    return <div className="text-fg-muted text-sm italic">No cards yet.</div>;
  }
  const max = Math.max(...TYPE_ORDER.map((t) => data[t] ?? 0), 1);
  const W = 320;
  const H = 110;
  const gap = 8;
  const barW = (W - gap * (TYPE_ORDER.length - 1)) / TYPE_ORDER.length;
  return (
    <div className="flex flex-col h-full" data-testid="gadget-cards-by-type">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {TYPE_ORDER.map((t, i) => {
          const v = data[t] ?? 0;
          const h = (v / max) * (H - 24);
          return (
            <g key={t}>
              <rect
                x={i * (barW + gap)}
                y={H - h - 18}
                width={barW}
                height={h}
                fill="currentColor"
                opacity={v > 0 ? 0.7 : 0.15}
                rx="2"
              >
                <title>{`${t}: ${v}`}</title>
              </rect>
              <text
                x={i * (barW + gap) + barW / 2}
                y={H - h - 22}
                fontSize="10"
                fill="currentColor"
                textAnchor="middle"
                opacity="0.7"
                fontFamily="var(--font-mono)"
              >
                {v}
              </text>
              <text
                x={i * (barW + gap) + barW / 2}
                y={H - 4}
                fontSize="9"
                fill="currentColor"
                opacity="0.55"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {t.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mono-meta-sm text-fg-faint mt-2 text-right">
        {total} TOTAL
      </div>
    </div>
  );
}
