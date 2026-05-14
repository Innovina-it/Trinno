"use server";

import { sql } from "drizzle-orm";

import { getSessionToken, requireUser } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { type Preferences } from "@/lib/preferences/types";

type PreferencesRow = {
  preferences: Preferences | null;
};

function assertPreferencePatch(
  value: Partial<Preferences>,
): Partial<Preferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid preferences payload");
  }
  return value;
}

function toJsonb(patch: Partial<Preferences>): string {
  const json = JSON.stringify(patch);
  if (!json || json === "undefined") {
    throw new Error("Invalid preferences payload");
  }
  return json;
}

export async function getUserPreferences(): Promise<Preferences> {
  const user = await requireUser();
  const token = (await getSessionToken())!;

  return dbAsUser(token, async (tx) => {
    const rows = (await tx.execute(
      sql`
        select preferences
        from public.user_preferences
        where user_id = ${user.id}::uuid
        limit 1
      `,
    )) as unknown as PreferencesRow[];

    return rows[0]?.preferences ?? {};
  });
}

// Debouncing is client-side; these actions atomically merge the patch they receive.
export async function setUserPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Promise<void> {
  await setUserPreferences({ [key]: value } as Partial<Preferences>);
}

export async function setUserPreferences(
  partial: Partial<Preferences>,
): Promise<void> {
  const patch = assertPreferencePatch(partial);
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const json = toJsonb(patch);

  await dbAsUser(token, async (tx) => {
    await tx.execute(
      sql`
        insert into public.user_preferences (user_id, preferences, updated_at)
        values (${user.id}::uuid, ${json}::jsonb, now())
        on conflict (user_id) do update
        set preferences = public.user_preferences.preferences || excluded.preferences,
            updated_at = now()
      `,
    );
  });
}
