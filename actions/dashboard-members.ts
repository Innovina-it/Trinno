"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { dashboardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  ShareDashboardInput,
  ChangeDashboardRoleInput,
  RemoveDashboardMemberInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function shareDashboardImpl(
  token: string,
  input: { dashboardId: string; email: string; role: "viewer" | "editor" },
) {
  const p = ShareDashboardInput.parse(input);
  const addedBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${p.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId) throw new Error("No user with that email");
    if (userId === addedBy) throw new Error("That's you");

    const [row] = await tx
      .insert(dashboardMembers)
      .values({ dashboardId: p.dashboardId, userId, role: p.role, addedBy })
      .onConflictDoUpdate({
        target: [dashboardMembers.dashboardId, dashboardMembers.userId],
        set: { role: p.role },
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function changeDashboardRoleImpl(
  token: string,
  input: { dashboardId: string; userId: string; role: "viewer" | "editor" },
) {
  const p = ChangeDashboardRoleInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(dashboardMembers)
      .set({ role: p.role })
      .where(
        and(
          eq(dashboardMembers.dashboardId, p.dashboardId),
          eq(dashboardMembers.userId, p.userId),
        ),
      )
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function removeDashboardMemberImpl(
  token: string,
  input: { dashboardId: string; userId: string },
) {
  const p = RemoveDashboardMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(dashboardMembers)
      .where(
        and(
          eq(dashboardMembers.dashboardId, p.dashboardId),
          eq(dashboardMembers.userId, p.userId),
        ),
      )
      .returning({ userId: dashboardMembers.userId });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function shareDashboard(
  input: Parameters<typeof shareDashboardImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await shareDashboardImpl(t, input);
  revalidatePath(`/dashboards/${input.dashboardId}`);
  return r;
}
export async function changeDashboardRole(
  input: Parameters<typeof changeDashboardRoleImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await changeDashboardRoleImpl(t, input);
  revalidatePath(`/dashboards/${input.dashboardId}`);
  return r;
}
export async function removeDashboardMember(
  input: Parameters<typeof removeDashboardMemberImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  await removeDashboardMemberImpl(t, input);
  revalidatePath(`/dashboards/${input.dashboardId}`);
}
