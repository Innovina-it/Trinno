import { eq, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { dashboards, gadgets } from "@/lib/db/schema";

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
