import { BurndownChart } from "@/components/sprint/burndown-chart";

export function GadgetBurndown({
  data,
}: {
  data: {
    total: number;
    points: Array<{
      day: string;
      pointsRemaining: number;
      idealRemaining: number;
      pointsCompleted: number;
    }>;
  } | null;
}) {
  if (!data || data.points.length === 0) {
    return <div className="text-sm text-fg-faint">No active sprint.</div>;
  }
  return <BurndownChart total={data.total} points={data.points} />;
}
