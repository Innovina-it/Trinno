"use client";
import { useActivitySync } from "@/hooks/use-activity-sync";

// Render-less companion to <ActivityFeed/>: keeps the server-rendered
// feed live by listening to `activity` CDC for the board and triggering
// a router.refresh() on each new row.
export function ActivityFeedSync({ boardId }: { boardId: string }) {
  useActivitySync(boardId);
  return null;
}
