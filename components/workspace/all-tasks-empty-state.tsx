"use client";
import Link from "next/link";

export function AllTasksEmptyState({
  workspaceId,
  reason,
}: {
  workspaceId: string;
  reason: "no-boards" | "no-mine" | "no-status-mapping" | "filtered-out";
}) {
  if (reason === "no-boards") {
    return (
      <div
        data-testid="all-tasks-empty-no-boards"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">No boards yet.</p>
        <p className="mono-meta-sm text-fg-muted">
          Create a board to start collecting tasks here.
        </p>
        <Link
          href={`/w/${workspaceId}`}
          className="chip mono-meta-sm hover:bg-fg/10"
        >
          ← Back to workspace
        </Link>
      </div>
    );
  }
  if (reason === "no-status-mapping") {
    return (
      <div
        data-testid="all-tasks-empty-no-status"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">No status mappings yet.</p>
        <p className="mono-meta-sm text-fg-muted">
          Open a board&apos;s settings and map each list to a status (To Do / In
          Progress / Done / etc.) — those mappings drive the columns here.
        </p>
      </div>
    );
  }
  if (reason === "no-mine") {
    return (
      <div
        data-testid="all-tasks-empty-no-mine"
        className="text-center py-16 space-y-4 max-w-md mx-auto"
      >
        <p className="serif-display text-3xl">Nothing assigned to you.</p>
        <p className="mono-meta-sm text-fg-muted">
          Switch to <strong>ALL WORKSPACE</strong> to see every card across
          boards.
        </p>
      </div>
    );
  }
  // filtered-out
  return (
    <div
      data-testid="all-tasks-empty-filtered"
      className="text-center py-16 space-y-4 max-w-md mx-auto"
    >
      <p className="serif-display text-3xl">No matches.</p>
      <p className="mono-meta-sm text-fg-muted">
        Try a broader search or clear active filters.
      </p>
    </div>
  );
}
