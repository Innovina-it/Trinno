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

// Per-type chrome. Markdown notes render flat and chrome-less so editorial
// content does not wear a metric tile shell. Charts (velocity, burndown)
// drop the visible header — the chart self-labels through its bars/lines.
// Stat tiles (count, on-roadmap, due, assigned, recent) keep the glass +
// header so dense numerics read as quantified surfaces.
type Variant = "glass" | "flat";
// Markdown is editorial chrome-less. Velocity + burndown carry their own
// titled glass wrapper, so the shell goes flat to avoid nested cards.
const VARIANT_BY_TYPE: Record<string, Variant> = {
  markdown_note: "flat",
  velocity: "flat",
  burndown: "flat",
};
const HEADER_HIDDEN: Record<string, boolean> = {
  markdown_note: true,
  velocity: true,
  burndown: true,
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
  const variant = VARIANT_BY_TYPE[type] ?? "glass";
  const hideHeader = HEADER_HIDDEN[type] ?? false;

  const wrapperClass =
    variant === "flat"
      ? "h-full flex flex-col"
      : "h-full flex flex-col rounded-2xl border border-hairline bg-[color:var(--surface)] p-4";

  return (
    <section className={wrapperClass} data-gadget-type={type}>
      {hideHeader ? (
        // No visible title. Owner actions float in the top-right corner.
        isOwner && (
          <div className="flex justify-end mb-2">
            <GadgetActions
              id={id}
              type={type}
              dashboardId={dashboardId}
              config={config}
              size={size}
            />
          </div>
        )
      ) : (
        <header className="flex items-baseline justify-between gap-2 mb-3">
          <h3 className="mono-meta text-fg-muted truncate">
            {title.toUpperCase()}
          </h3>
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
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}
