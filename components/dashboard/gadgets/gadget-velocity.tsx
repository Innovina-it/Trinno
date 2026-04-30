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
    return (
      <div className="text-fg-muted text-sm italic">
        No completed sprints yet.
      </div>
    );
  }
  return (
    <div className="-m-4">
      <VelocityStrip data={data} />
    </div>
  );
}
