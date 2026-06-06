import { describe, expect, it } from "vitest";
import type { NotificationKind } from "@/lib/notifications/email-labels";
import { EMAIL_KIND_LABELS } from "@/lib/notifications/email-labels";
import {
  defaultExternalEnabled,
  defaultExternalOn,
  KIND_TIERS,
  NOTIFICATION_KINDS,
} from "@/lib/notifications/kind-config";

// SSOT invariant for the tiered per-event notification matrix.  These assertions
// are the contract that keeps the settings UI and the telegram dispatcher
// honest: both read `defaultExternalOn(kind)` from kind-config, so the tier
// membership + per-tier default proven here IS the live send default.

// The approved spec, transcribed verbatim.  Tier 1 is the only default-ON tier.
const TIER_1: NotificationKind[] = [
  "comment.mention",
  "card.assigned",
  "card.owner_assigned",
  "card.due",
  "board.member.added",
];
const TIER_2: NotificationKind[] = [
  "comment.create",
  "card.completed",
  "card.dates",
  "card.unassigned",
  "card.owner_unassigned",
  "card.sprint_changed",
  "card.moved",
];
const TIER_3: NotificationKind[] = [
  "card.label.added",
  "card.linked",
  "card.archived",
  "card.unarchived",
];

// Every kind in email-labels' NotificationKind union (the canonical catalogue).
const ALL_KINDS = Object.keys(EMAIL_KIND_LABELS) as NotificationKind[];

describe("kind-config SSOT", () => {
  it("has 16 unique kinds", () => {
    expect(NOTIFICATION_KINDS).toHaveLength(16);
    const set = new Set(NOTIFICATION_KINDS.map((k) => k.kind));
    expect(set.size).toBe(16);
  });

  it("every kind exists in the email-labels NotificationKind union", () => {
    const canonical = new Set(ALL_KINDS);
    for (const k of NOTIFICATION_KINDS) {
      expect(canonical.has(k.kind)).toBe(true);
    }
  });

  it("covers exactly the canonical 16 kinds (no missing, no extras)", () => {
    const configured = new Set(NOTIFICATION_KINDS.map((k) => k.kind));
    for (const k of ALL_KINDS) expect(configured.has(k)).toBe(true);
    expect(configured.size).toBe(ALL_KINDS.length);
  });

  it("tier membership matches the approved spec exactly", () => {
    const byTier = (t: 1 | 2 | 3) =>
      NOTIFICATION_KINDS.filter((k) => k.tier === t).map((k) => k.kind).sort();
    expect(byTier(1)).toEqual([...TIER_1].sort());
    expect(byTier(2)).toEqual([...TIER_2].sort());
    expect(byTier(3)).toEqual([...TIER_3].sort());
  });

  it("Tier 1 kinds default ON for external channels", () => {
    for (const k of TIER_1) {
      expect(defaultExternalOn(k)).toBe(true);
      const cfg = NOTIFICATION_KINDS.find((c) => c.kind === k);
      expect(cfg?.tier).toBe(1);
      expect(cfg?.defaultExternalOn).toBe(true);
    }
  });

  it("Tier 2 & 3 kinds default OFF for external channels", () => {
    for (const k of [...TIER_2, ...TIER_3]) {
      expect(defaultExternalOn(k)).toBe(false);
      const cfg = NOTIFICATION_KINDS.find((c) => c.kind === k);
      expect(cfg?.defaultExternalOn).toBe(false);
    }
  });

  it("defaultExternalOn is OFF for an unknown kind", () => {
    expect(defaultExternalOn("does.not.exist")).toBe(false);
  });

  it("defaultExternalEnabled is a back-compat alias of defaultExternalOn", () => {
    expect(defaultExternalEnabled).toBe(defaultExternalOn);
    for (const k of NOTIFICATION_KINDS) {
      expect(defaultExternalEnabled(k.kind)).toBe(defaultExternalOn(k.kind));
    }
  });

  it("NOTIFICATION_KINDS is ordered Tier 1 -> 2 -> 3", () => {
    const tiers = NOTIFICATION_KINDS.map((k) => k.tier);
    const sorted = [...tiers].sort((a, b) => a - b);
    expect(tiers).toEqual(sorted);
  });

  it("KIND_TIERS groups all kinds with the tier's shared default", () => {
    expect(KIND_TIERS.map((g) => g.tier)).toEqual([1, 2, 3]);
    const flattened = KIND_TIERS.flatMap((g) => g.kinds.map((k) => k.kind));
    expect(flattened).toEqual(NOTIFICATION_KINDS.map((k) => k.kind));
    for (const g of KIND_TIERS) {
      for (const k of g.kinds) {
        expect(k.defaultExternalOn).toBe(g.defaultExternalOn);
      }
    }
    expect(KIND_TIERS.find((g) => g.tier === 1)?.defaultExternalOn).toBe(true);
    expect(KIND_TIERS.find((g) => g.tier === 2)?.defaultExternalOn).toBe(false);
    expect(KIND_TIERS.find((g) => g.tier === 3)?.defaultExternalOn).toBe(false);
  });
});
