import type { MyActiveSprint } from "@/lib/queries/me-sprints";
import type { BurndownPoint } from "@/lib/queries/sprints-stats";
import { formatDate } from "@/lib/format-date";

interface Props {
  sprints: MyActiveSprint[];
  burndowns: Record<string, BurndownPoint[]>;
}

function daysRemaining(endDate: Date | null): number {
  if (!endDate) return 0;
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 86_400_000));
}

function SparklineSVG({ points }: { points: BurndownPoint[] }) {
  if (points.length < 2) return null;

  const HEIGHT = 80;
  const WIDTH = 300; // viewBox width; SVG stretches to container

  const ideals = points.map((p) => p.idealRemaining);
  const actuals = points.map((p) => p.pointsRemaining);
  const allVals = [...ideals, ...actuals];
  const maxVal = Math.max(...allVals, 1);

  const xStep = WIDTH / (points.length - 1);
  const toX = (i: number) => i * xStep;
  const toY = (v: number) => HEIGHT - (v / maxVal) * HEIGHT;

  const idealPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.idealRemaining).toFixed(1)}`)
    .join(" ");

  const actualPath = points
    .map((p, i) =>
      `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.pointsRemaining).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: HEIGHT }}
      aria-hidden="true"
    >
      {/* ideal — dashed, low opacity */}
      <path
        d={idealPath}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      {/* actual — solid */}
      <path
        d={actualPath}
        fill="none"
        stroke="currentColor"
        strokeOpacity="1"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "6px 8px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.04)",
        minWidth: 60,
      }}
    >
      <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{value}</span>
    </div>
  );
}

export function MeActiveSprints({ sprints, burndowns }: Props) {
  return (
    <div data-testid="me-active-sprints" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sprints.length === 0 ? (
        <div style={{ textAlign: "center", opacity: 0.5, padding: "24px 0", letterSpacing: "0.08em" }}>
          NO ACTIVE SPRINTS
        </div>
      ) : (
        sprints.map((sprint) => {
          const days = daysRemaining(sprint.endDate);
          const sprintPct =
            sprint.totalPoints > 0
              ? Math.round((sprint.totalCompletedPoints / sprint.totalPoints) * 100)
              : 0;
          const bdPoints = burndowns[sprint.id] ?? [];
          const href = `/w/${sprint.workspaceId}/sprints/${sprint.id}/report`;

          return (
            <a
              key={sprint.id}
              href={href}
              data-testid="me-active-sprint"
              data-sprint-id={sprint.id}
              style={{
                display: "block",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.08)",
                padding: 16,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{sprint.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.06)",
                    opacity: 0.7,
                    whiteSpace: "nowrap",
                  }}
                >
                  {sprint.workspaceName}
                </span>
              </div>

              {/* Date range + days remaining */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
                <span>
                  {formatDate(sprint.startDate) || "—"} – {formatDate(sprint.endDate) || "—"}
                </span>
                {sprint.endDate && (
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: days === 0 ? "rgba(220,50,50,0.15)" : "rgba(0,0,0,0.06)",
                      fontSize: 11,
                    }}
                  >
                    {days === 0 ? "ENDED" : `${days}d left`}
                  </span>
                )}
              </div>

              {/* Goal */}
              {sprint.goal && (
                <p
                  style={{
                    fontSize: 13,
                    opacity: 0.7,
                    marginBottom: 10,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    margin: "0 0 10px",
                  }}
                >
                  {sprint.goal}
                </p>
              )}

              {/* 4-tile mini grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                <StatTile label="MY CARDS" value={sprint.myCardCount} />
                <StatTile label="MY PTS" value={sprint.myPoints} />
                <StatTile label="MY DONE" value={sprint.myCompletedPoints} />
                <StatTile label="SPRINT %" value={`${sprintPct}%`} />
              </div>

              {/* Burndown sparkline */}
              <div style={{ width: "100%", opacity: 0.8 }}>
                <SparklineSVG points={bdPoints} />
              </div>
            </a>
          );
        })
      )}
    </div>
  );
}
