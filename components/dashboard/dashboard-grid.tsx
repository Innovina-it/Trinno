import { getSessionToken } from "@/lib/auth";
import { listGadgetsForDashboard } from "@/lib/queries/dashboards";
import {
  resolveCount,
  resolveRecentActivity,
  resolveAssignedToMe,
  resolveDueThisWeek,
  resolveVelocity,
  resolveBurndown,
  resolveCardsByType,
  resolveMarkdownNote,
} from "@/lib/dashboards/resolvers";
import { GadgetShell } from "@/components/dashboard/gadgets/gadget-shell";
import { GadgetCount } from "@/components/dashboard/gadgets/gadget-count";
import { GadgetRecentActivity } from "@/components/dashboard/gadgets/gadget-recent-activity";
import { GadgetAssignedToMe } from "@/components/dashboard/gadgets/gadget-assigned-to-me";
import { GadgetDueThisWeek } from "@/components/dashboard/gadgets/gadget-due-this-week";
import { GadgetVelocity } from "@/components/dashboard/gadgets/gadget-velocity";
import { GadgetBurndown } from "@/components/dashboard/gadgets/gadget-burndown";
import { GadgetCardsByType } from "@/components/dashboard/gadgets/gadget-cards-by-type";
import { GadgetMarkdownNote } from "@/components/dashboard/gadgets/gadget-markdown-note";

type GadgetRow = {
  id: string;
  dashboardId: string;
  type: string;
  config: unknown;
  size: string;
  position: number;
};

const SIZE_TO_CLASS: Record<string, string> = {
  "1x1": "col-span-1 row-span-1",
  "2x1": "col-span-1 sm:col-span-2 row-span-1",
  "2x2": "col-span-1 sm:col-span-2 row-span-2",
  "3x1": "col-span-1 sm:col-span-2 lg:col-span-3 row-span-1",
  "3x2": "col-span-1 sm:col-span-2 lg:col-span-3 row-span-2",
};

export async function DashboardGrid({
  dashboardId,
  ownerId,
  viewerId,
  workspaceId,
}: {
  dashboardId: string;
  ownerId: string;
  viewerId: string;
  workspaceId: string | null;
}) {
  const token = (await getSessionToken())!;
  const gadgets = (await listGadgetsForDashboard(
    token,
    dashboardId,
  )) as GadgetRow[];
  const isOwner = ownerId === viewerId;

  // Resolve all gadgets in parallel.
  const resolved = await Promise.all(
    gadgets.map(async (g) => {
      const config = (g.config ?? {}) as Record<string, unknown>;
      try {
        switch (g.type) {
          case "count": {
            const data = await resolveCount(token, viewerId, {
              what: (config.what as
                | "open_cards"
                | "overdue"
                | "my_assignments"
                | "completed_this_week") ?? "open_cards",
              workspaceId:
                (config.workspaceId as string | undefined) ??
                workspaceId ??
                undefined,
            });
            return { gadget: g, type: g.type, data };
          }
          case "recent_activity": {
            const data = await resolveRecentActivity(token, {
              workspaceId:
                (config.workspaceId as string | undefined) ??
                workspaceId ??
                undefined,
              limit: (config.limit as number | undefined) ?? 10,
            });
            return { gadget: g, type: g.type, data };
          }
          case "assigned_to_me": {
            const data = await resolveAssignedToMe(token, viewerId, {
              workspaceId:
                (config.workspaceId as string | undefined) ??
                workspaceId ??
                undefined,
            });
            return { gadget: g, type: g.type, data };
          }
          case "due_this_week": {
            const data = await resolveDueThisWeek(token, viewerId, {
              workspaceId:
                (config.workspaceId as string | undefined) ??
                workspaceId ??
                undefined,
            });
            return { gadget: g, type: g.type, data };
          }
          case "velocity": {
            const wsId =
              (config.workspaceId as string | undefined) ??
              workspaceId ??
              undefined;
            if (!wsId) return { gadget: g, type: g.type, data: [] };
            const data = await resolveVelocity(token, {
              workspaceId: wsId,
              n: (config.n as number | undefined) ?? 6,
            });
            return { gadget: g, type: g.type, data };
          }
          case "burndown": {
            const wsId =
              (config.workspaceId as string | undefined) ??
              workspaceId ??
              undefined;
            if (!wsId) return { gadget: g, type: g.type, data: null };
            const data = await resolveBurndown(token, { workspaceId: wsId });
            return { gadget: g, type: g.type, data };
          }
          case "cards_by_type": {
            const data = await resolveCardsByType(token, {
              workspaceId:
                (config.workspaceId as string | undefined) ??
                workspaceId ??
                undefined,
            });
            return { gadget: g, type: g.type, data };
          }
          case "markdown_note": {
            const data = await resolveMarkdownNote(token, {
              body: (config.body as string | undefined) ?? "",
            });
            return { gadget: g, type: g.type, data };
          }
          default:
            return { gadget: g, type: g.type, data: null };
        }
      } catch {
        return { gadget: g, type: g.type, data: null };
      }
    }),
  );

  if (resolved.length === 0) {
    return (
      <div
        className="text-center text-fg-muted py-20"
        data-testid="dashboard-empty"
      >
        <p className="pull-quote text-3xl">No gadgets yet.</p>
        <p className="mono-meta-sm mt-3">
          {isOwner
            ? "Use Add gadget to start composing your dashboard."
            : "Owner has not added any gadgets yet."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-[minmax(180px,auto)]"
      data-testid="dashboard-grid"
    >
      {resolved.map(({ gadget, type, data }) => {
        const sizeCls = SIZE_TO_CLASS[gadget.size] ?? SIZE_TO_CLASS["1x1"];
        return (
          <div
            key={gadget.id}
            className={sizeCls}
            data-testid="gadget"
            data-gadget-id={gadget.id}
            data-gadget-type={gadget.type}
          >
            <GadgetShell
              id={gadget.id}
              type={type}
              isOwner={isOwner}
              dashboardId={dashboardId}
              config={(gadget.config ?? {}) as Record<string, unknown>}
              size={gadget.size}
            >
              {renderGadgetBody(type, data)}
            </GadgetShell>
          </div>
        );
      })}
    </div>
  );
}

function renderGadgetBody(type: string, data: unknown) {
  switch (type) {
    case "count":
      return <GadgetCount data={data as { value: number; label: string } | null} />;
    case "recent_activity":
      return (
        <GadgetRecentActivity
          rows={
            (data ?? []) as Array<{
              id: string;
              type: string;
              payload: unknown;
              createdAt: Date | string;
              actorName: string | null;
            }>
          }
        />
      );
    case "assigned_to_me":
      return (
        <GadgetAssignedToMe
          rows={
            (data ?? []) as Array<{
              id: string;
              title: string;
              boardId: string;
              dueDate: Date | string | null;
              type: string;
              boardTitle: string;
            }>
          }
        />
      );
    case "due_this_week":
      return (
        <GadgetDueThisWeek
          rows={
            (data ?? []) as Array<{
              id: string;
              title: string;
              boardId: string;
              dueDate: Date | string | null;
              type: string;
              boardTitle: string;
            }>
          }
        />
      );
    case "velocity":
      return (
        <GadgetVelocity
          data={
            (data ?? []) as Array<{
              sprintId: string;
              name: string;
              pointsCompleted: number;
            }>
          }
        />
      );
    case "burndown":
      return (
        <GadgetBurndown
          data={
            data as {
              total: number;
              points: Array<{
                day: string;
                pointsRemaining: number;
                idealRemaining: number;
                pointsCompleted: number;
              }>;
            } | null
          }
        />
      );
    case "cards_by_type":
      return (
        <GadgetCardsByType
          data={(data ?? {}) as Record<string, number>}
        />
      );
    case "markdown_note":
      return (
        <GadgetMarkdownNote body={(data as { body: string } | null)?.body ?? ""} />
      );
    default:
      return (
        <div className="text-fg-muted text-sm italic">
          Unknown gadget type
        </div>
      );
  }
}
