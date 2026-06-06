import type { NotificationKind } from "@/lib/notifications/email-labels";

// Single source of truth for the user-facing notification catalogue: every
// kind that the DB triggers can emit (see notifications_kind_check, migration
// 0087) — all 16 — together with display copy, a priority tier, and the
// per-kind default for EXTERNAL channels (email + telegram).
//
// Consumed by:
//   * the settings matrix (app/(app)/settings/notifications) — render order
//     and which boxes are pre-checked for external channels;
//   * the per-event dispatcher (lib/notifications/dispatch.ts) — the default
//     applied when the user has NO explicit user_notification_prefs row for a
//     (kind, external-channel) pair.
//
// Channel default policy (read by both consumers):
//   in-app  : absence of a pref row => ENABLED  (unchanged; all 16 on).
//   email   : absence => STRICT opt-in (the form requires email[kind]===true;
//             email is NOT the live channel and is never pre-checked).
//   telegram: absence => `defaultExternalOn(kind)`.
//
// THE HONEST-WIRING INVARIANT: the telegram column's checked-by-default state
// in the settings matrix MUST equal the dispatcher's behaviour when no pref row
// exists.  Both read `defaultExternalOn(kind)` from THIS file, so a Tier-1 box
// shown checked-by-default actually sends, and a Tier-2/3 box shown unchecked
// does not.  No lying controls.  (Before this change the dispatcher was strict
// opt-in — "absence => skip" — while the UI pre-checked boxes; that lie is what
// this file now removes.)
//
// External delivery is still globally gated by the master
// `profiles.notify_per_event` toggle (default OFF) and by isLinked — so a
// `true` default here only pre-checks the box; nothing reaches a user until the
// master is on and telegram is linked.  (isLinked is Gate 1 in the dispatcher;
// the master toggle is enforced upstream of the per-event dispatch loop.)

export type KindTier = 1 | 2 | 3;

export type KindConfig = {
  kind: NotificationKind;
  /** Matrix row title. */
  label: string;
  /** Matrix row sub-label. */
  desc: string;
  /** Priority bucket; also the display grouping (1 = highest). */
  tier: KindTier;
  /** Default state for email + telegram when no explicit pref row exists.
   *  in-app is always default-ON regardless of this flag. */
  defaultExternalOn: boolean;
};

// Ordered by priority, highest first. Array order IS the matrix order.
export const NOTIFICATION_KINDS: KindConfig[] = [
  // ── Tier 1 — direct & actionable: addressed to you, a deadline, or an
  //    access change. Default ON for external channels (the important pings).
  {
    kind: "comment.mention",
    label: "Mentions",
    desc: "Someone @mentions you in a comment.",
    tier: 1,
    defaultExternalOn: true,
  },
  {
    kind: "card.assigned",
    label: "Assigned to you",
    desc: "A card is assigned to you.",
    tier: 1,
    defaultExternalOn: true,
  },
  {
    kind: "card.owner_assigned",
    label: "Made owner",
    desc: "You're set as the owner of a card.",
    tier: 1,
    defaultExternalOn: true,
  },
  {
    kind: "card.due",
    label: "Due date",
    desc: "A card you follow reaches its due date.",
    tier: 1,
    defaultExternalOn: true,
  },
  {
    kind: "board.member.added",
    label: "Added to a board",
    desc: "You're added as a member of a board.",
    tier: 1,
    defaultExternalOn: true,
  },

  // ── Tier 2 — relevant but not urgent. In-app on; external opt-in (default OFF).
  {
    kind: "comment.create",
    label: "New comments",
    desc: "A new comment on a card you follow.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.completed",
    label: "Completions",
    desc: "A card you follow is marked complete.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.dates",
    label: "Reschedules",
    desc: "A card's start/due dates change.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.unassigned",
    label: "Unassigned",
    desc: "You're removed from a card.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.owner_unassigned",
    label: "Owner removed",
    desc: "You're removed as a card owner.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.sprint_changed",
    label: "Sprint moves",
    desc: "A card you follow moves to another sprint.",
    tier: 2,
    defaultExternalOn: false,
  },
  {
    kind: "card.moved",
    label: "Card moves",
    desc: "A card you follow moves list or board.",
    tier: 2,
    defaultExternalOn: false,
  },

  // ── Tier 3 — informational / noise-prone. Off by default on external channels.
  {
    kind: "card.label.added",
    label: "Label updates",
    desc: "A label is added to a card you follow.",
    tier: 3,
    defaultExternalOn: false,
  },
  {
    kind: "card.linked",
    label: "Card links",
    desc: "A card you follow is linked to another.",
    tier: 3,
    defaultExternalOn: false,
  },
  {
    kind: "card.archived",
    label: "Archives",
    desc: "A card you follow is archived.",
    tier: 3,
    defaultExternalOn: false,
  },
  {
    kind: "card.unarchived",
    label: "Restores",
    desc: "An archived card you follow is restored.",
    tier: 3,
    defaultExternalOn: false,
  },
];

/**
 * Telegram per-kind default when no explicit user_notification_prefs row
 * exists.  This is THE shared fallback: the settings matrix uses it to compute
 * the telegram cell's default checked state, and the dispatcher uses it as the
 * `prefRow?.enabled ?? defaultExternalOn(kind)` fallback.  Keeping a single
 * implementation is what makes the UI default == dispatcher default.
 *
 * Unknown kinds default to OFF (conservative): never send something the
 * catalogue doesn't describe.
 */
export function defaultExternalOn(kind: string): boolean {
  return (
    NOTIFICATION_KINDS.find((k) => k.kind === kind)?.defaultExternalOn ?? false
  );
}

/** @deprecated alias retained for back-compat — use `defaultExternalOn`. */
export const defaultExternalEnabled = defaultExternalOn;

// ── Display grouping ────────────────────────────────────────────────────────
// The settings matrix renders one collapsible section per tier.  KIND_TIERS is
// the ordered grouping (Tier 1 → 2 → 3) with the section copy and the tier's
// shared external default, derived from NOTIFICATION_KINDS so this file stays
// the single source of truth.

export type TierGroup = {
  tier: KindTier;
  /** Short section title used in the matrix header, e.g. "Direct & actionable". */
  title: string;
  /** The shared `defaultExternalOn` for every kind in the tier. */
  defaultExternalOn: boolean;
  kinds: KindConfig[];
};

const TIER_TITLES: Record<KindTier, string> = {
  1: "Direct & actionable",
  2: "Activity",
  3: "Low signal",
};

/** Ordered Tier 1 → 2 → 3, each with its kinds and shared external default. */
export const KIND_TIERS: TierGroup[] = ([1, 2, 3] as const).map((tier) => {
  const kinds = NOTIFICATION_KINDS.filter((k) => k.tier === tier);
  return {
    tier,
    title: TIER_TITLES[tier],
    // Every kind in a tier shares the same default by construction; read it off
    // the first member (fall back to false for an empty tier).
    defaultExternalOn: kinds[0]?.defaultExternalOn ?? false,
    kinds,
  };
});
