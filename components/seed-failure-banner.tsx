"use client";
import { useEffect } from "react";
import { errorBus } from "@/lib/errors/error-bus";

/**
 * Plan errors-onboarding (U4) — surface partial-seed failures to the
 * newly-signed-up user. The auth callback writes `tr_seed_report`
 * with `{ failedSteps: string[] }`; this component reads it on mount,
 * pushes a SEED_PARTIAL entry through the errorBus, then deletes the
 * cookie so the banner only fires once per signup. ErrorPane handles
 * the actual rendering via lib/errors/copy.ts.
 *
 * Returns null — no markup of its own. Mount once in the app layout.
 */
export function SeedFailureBanner() {
  useEffect(() => {
    const failedSteps = readSeedReportCookie();
    if (!failedSteps || failedSteps.length === 0) return;
    deleteSeedReportCookie();
    errorBus.push({
      code: "SEED_PARTIAL",
      message: formatFailedSteps(failedSteps),
      context: { failedSteps },
    });
  }, []);
  return null;
}

/**
 * Exported for the unit test — keeps the cookie shape parsing pure
 * so we can verify the bus push pipeline without mounting the
 * component into jsdom.
 */
export function readSeedReportCookie(
  cookieJar = typeof document === "undefined" ? "" : document.cookie,
): string[] | null {
  const match = cookieJar.match(/(?:^|;\s*)tr_seed_report=([^;]+)/);
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match[1]);
    const parsed = JSON.parse(raw) as { failedSteps?: unknown };
    if (!Array.isArray(parsed.failedSteps)) return null;
    const steps = parsed.failedSteps.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}

function deleteSeedReportCookie() {
  if (typeof document === "undefined") return;
  document.cookie =
    "tr_seed_report=; path=/; max-age=0; samesite=lax";
}

export function formatFailedSteps(steps: string[]): string {
  const head = steps.slice(0, 4);
  const remainder = steps.length - head.length;
  const list = head.join(", ");
  if (remainder > 0) return `Steps that failed: ${list} (+${remainder} more)`;
  return `Steps that failed: ${list}`;
}
