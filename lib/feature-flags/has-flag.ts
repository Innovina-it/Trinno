import { createSupabaseServer } from "@/lib/supabase/server";
import type { FlagName } from "./index";

function readFlagValue(flags: unknown, flag: FlagName): boolean | undefined {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return undefined;
  }

  const record = flags as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, flag)) return undefined;

  const value = record[flag];
  return typeof value === "boolean" ? value : undefined;
}

export async function hasFlag(
  workspaceId: string,
  flag: FlagName,
  fallback = false,
): Promise<boolean> {
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase
      .from("workspaces")
      .select("feature_flags")
      .eq("id", workspaceId)
      .maybeSingle();

    if (error || !data) return fallback;

    return (
      readFlagValue(
        (data as { feature_flags?: unknown }).feature_flags,
        flag,
      ) ?? fallback
    );
  } catch {
    return fallback;
  }
}
