"use client";
import type { RoadmapCard, RoadmapLink } from "@/lib/queries/roadmap";

// Placeholder mounted by /w/[workspaceId]/roadmap until Task 6 wires the
// drag-resize-move bars + dependency arrows.
export function RoadmapView({
  initialCards,
  initialLinks,
  workspaceId,
}: {
  initialCards: RoadmapCard[];
  initialLinks: RoadmapLink[];
  workspaceId: string;
}) {
  return (
    <div data-testid="roadmap-view" data-workspace-id={workspaceId}>
      <p className="font-serif italic text-fg-faint">
        Roadmap view — {initialCards.length} cards, {initialLinks.length}{" "}
        dependencies.
      </p>
    </div>
  );
}
