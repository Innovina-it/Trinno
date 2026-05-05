import { VelocityStrip } from "@/components/sprint/velocity-strip";

export function GadgetVelocity({
  data,
}: {
  data: Array<{
    sprintId: string;
    name: string;
    pointsCompleted: number;
  }>;
}) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-fg-faint">No completed sprints yet.</div>;
  }
  return <VelocityStrip data={data} />;
}
