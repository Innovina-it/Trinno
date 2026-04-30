export function GadgetCount({
  data,
}: {
  data: { value: number; label: string } | null;
}) {
  if (!data) {
    return (
      <div className="text-fg-muted text-sm italic">No data.</div>
    );
  }
  return (
    <div className="flex flex-col h-full justify-center items-start">
      <div
        className="serif-display text-5xl tabular-nums"
        data-testid="gadget-count-value"
      >
        {data.value}
      </div>
      <div className="mono-meta-sm text-fg-muted mt-2">
        {data.label.toUpperCase()}
      </div>
    </div>
  );
}
