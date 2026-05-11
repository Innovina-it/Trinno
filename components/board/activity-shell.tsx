"use client";
import { useActivityPanel } from "@/lib/use-activity-panel";

export function ActivityShell({ children }: { children: React.ReactNode }) {
  const { open } = useActivityPanel();
  if (!open) return null;
  // The header pill in BoardView owns the toggle — the panel itself is
  // chrome-less so the rendered list is the only thing on screen.
  return <>{children}</>;
}
