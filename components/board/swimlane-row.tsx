import type { Lane } from "@/lib/board-filters";

export function SwimlaneRow({
  lane, children,
}: { lane: Lane; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <header className="px-4 py-2 border-y border-hairline bg-[rgb(255_255_255/0.02)] sticky top-14 z-10 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="serif-display text-lg">{lane.label || "—"}</span>
          <span className="mono-meta-sm text-fg-faint">{lane.cardIds.length} CARD{lane.cardIds.length === 1 ? "" : "S"}</span>
        </div>
      </header>
      {children}
    </section>
  );
}
