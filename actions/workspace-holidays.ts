"use server";
import { revalidatePath } from "next/cache";
import { eq, and, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceHolidays, workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  UpsertWorkspaceHolidayInput,
  MuteWorkspaceHolidayInput,
  UnmuteWorkspaceHolidayInput,
  DeleteWorkspaceHolidayInput,
} from "@/lib/validation";

type HolidayTx = Parameters<Parameters<typeof dbAsUser>[1]>[0];

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

async function assertCanManageCalendar(
  tx: HolidayTx,
  workspaceId: string,
  userId: string,
) {
  const [membership] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    throw new Error("Only workspace owners and admins can manage the calendar.");
  }
}

function revalidateAfterWrite(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/settings`);
  revalidatePath(`/w/${workspaceId}/r`);
  revalidatePath(`/w/${workspaceId}`);
}

/**
 * Add a custom holiday, or rename a preset for this workspace. Upserts
 * by (workspace_id, iso_date). Validation guarantees `name` is non-empty.
 */
export async function upsertWorkspaceHoliday(
  input: { workspaceId: string; isoDate: string; name: string },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const p = UpsertWorkspaceHolidayInput.parse(input);
  const actorId = decodeSub(token);
  await dbAsUser(token, async (tx) => {
    await assertCanManageCalendar(tx, p.workspaceId, actorId);
    await tx
      .insert(workspaceHolidays)
      .values({
        workspaceId: p.workspaceId,
        isoDate: p.isoDate,
        name: p.name,
      })
      .onConflictDoUpdate({
        target: [workspaceHolidays.workspaceId, workspaceHolidays.isoDate],
        set: { name: p.name, updatedAt: sql`now()` },
      });
  });
  revalidateAfterWrite(p.workspaceId);
}

/**
 * Mute a preset for this workspace (e.g. office works on Ferragosto).
 * Upserts a row with `name = NULL`. No-op if the iso isn't a preset.
 */
export async function muteWorkspaceHoliday(
  input: { workspaceId: string; isoDate: string },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const p = MuteWorkspaceHolidayInput.parse(input);
  const actorId = decodeSub(token);
  await dbAsUser(token, async (tx) => {
    await assertCanManageCalendar(tx, p.workspaceId, actorId);
    await tx
      .insert(workspaceHolidays)
      .values({
        workspaceId: p.workspaceId,
        isoDate: p.isoDate,
        name: null,
      })
      .onConflictDoUpdate({
        target: [workspaceHolidays.workspaceId, workspaceHolidays.isoDate],
        set: { name: null, updatedAt: sql`now()` },
      });
  });
  revalidateAfterWrite(p.workspaceId);
}

/**
 * Restore a previously-muted preset. Deletes the override row so the
 * preset's default name + date take effect again.
 */
export async function unmuteWorkspaceHoliday(
  input: { workspaceId: string; isoDate: string },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const p = UnmuteWorkspaceHolidayInput.parse(input);
  const actorId = decodeSub(token);
  await dbAsUser(token, async (tx) => {
    await assertCanManageCalendar(tx, p.workspaceId, actorId);
    await tx
      .delete(workspaceHolidays)
      .where(
        and(
          eq(workspaceHolidays.workspaceId, p.workspaceId),
          eq(workspaceHolidays.isoDate, p.isoDate),
        ),
      );
  });
  revalidateAfterWrite(p.workspaceId);
}

/**
 * Delete an override row outright. For a *preset* date, this restores
 * the preset's default (same as `unmute`). For a *custom* date, this
 * removes the entry entirely.
 */
export async function deleteWorkspaceHoliday(
  input: { workspaceId: string; isoDate: string },
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const p = DeleteWorkspaceHolidayInput.parse(input);
  const actorId = decodeSub(token);
  await dbAsUser(token, async (tx) => {
    await assertCanManageCalendar(tx, p.workspaceId, actorId);
    await tx
      .delete(workspaceHolidays)
      .where(
        and(
          eq(workspaceHolidays.workspaceId, p.workspaceId),
          eq(workspaceHolidays.isoDate, p.isoDate),
        ),
      );
  });
  revalidateAfterWrite(p.workspaceId);
}
