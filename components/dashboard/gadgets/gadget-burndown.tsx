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
    return (
      <div className="text-fg-muted text-sm italic">No active sprint.</div>
    );
  }
  return (
    <div className="-m-4">
      <BurndownChart total={data.total} points={data.points} />
    </div>
  );
}
