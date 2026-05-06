import { eq, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { dashboards, dashboardMembers, gadgets, profiles } from "@/lib/db/schema";

export async function listDashboards(token: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(dashboards).orderBy(asc(dashboards.name)),
  );
}

export async function getDashboard(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select()
      .from(dashboards)
      .where(eq(dashboards.id, id));
    return row ?? null;
  });
}

export async function listGadgetsForDashboard(
  token: string,
  dashboardId: string,
) {
  return dbAsUser(token, async (tx) =>
    tx
      .select()
      .from(gadgets)
      .where(eq(gadgets.dashboardId, dashboardId))
      .orderBy(asc(gadgets.position)),
  );
}

export type DashboardMemberRow = {
  userId: string;
  role: "viewer" | "editor";
  displayName: string;
  handle: string;
};

export async function listDashboardMembers(
  token: string,
  dashboardId: string,
): Promise<DashboardMemberRow[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        userId: dashboardMembers.userId,
        role: dashboardMembers.role,
        displayName: profiles.displayName,
        handle: profiles.handle,
      })
      .from(dashboardMembers)
      .leftJoin(profiles, eq(profiles.id, dashboardMembers.userId))
      .where(eq(dashboardMembers.dashboardId, dashboardId))
      .orderBy(asc(profiles.displayName));
    return rows.map((r) => ({
      userId: r.userId,
      role: r.role,
      displayName: r.displayName ?? "Unknown",
      handle: r.handle ?? "",
    }));
  });
}
