import type { ReactNode } from "react";
import { GadgetActions } from "@/components/dashboard/gadget-actions";

const TYPE_LABEL: Record<string, string> = {
  count: "Count",
  recent_activity: "Recent activity",
  assigned_to_me: "Assigned to me",
  due_this_week: "Due this week",
  velocity: "Velocity",
  burndown: "Burndown",
  cards_by_type: "Cards by type",
  markdown_note: "Note",
};

export function GadgetShell({
  id,
  type,
  isOwner,
  dashboardId,
  config,
  size,
  children,
}: {
  id: string;
  type: string;
  isOwner: boolean;
  dashboardId: string;
  config: Record<string, unknown>;
  size: string;
  children: ReactNode;
}) {
  const title = TYPE_LABEL[type] ?? type;
  return (
    <section className="glass rounded-2xl p-4 h-full flex flex-col">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="mono-meta text-fg-muted truncate">{title.toUpperCase()}</h3>
        {isOwner && (
          <GadgetActions
            id={id}
            type={type}
            dashboardId={dashboardId}
            config={config}
            size={size}
          />
        )}
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}
