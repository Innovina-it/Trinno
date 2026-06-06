"use client";
import { useEffect, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  listNotificationPrefs,
  setNotificationPref,
} from "@/actions/user-notification-prefs";
import {
  defaultExternalOn,
  KIND_TIERS,
  type KindConfig,
} from "@/lib/notifications/kind-config";

type Channel = "in_app" | "email" | "telegram";

// Bulk control tri-state for a tier's TELEGRAM column.
type TriState = "all" | "none" | "mixed";

export function NotificationPrefsForm({
  notifyPerEvent,
  channelAvailable,
  linked,
}: {
  // Master "Notify me on every event" switch. When OFF, external columns
  // (email + telegram) grey out; in-app stays interactive.
  notifyPerEvent: boolean;
  // hasExternalDeliveryChannel() — when false the external columns grey out
  // regardless of the master.
  channelAvailable: boolean;
  // Telegram account linked — when false the telegram column greys out.
  linked: boolean;
}) {
  // Map<channel, Map<kind, enabled>>.  in_app defaults TRUE when no row exists;
  // telegram defaults to the kind's tiered default (defaultExternalOn); email
  // is STRICT (only an explicit enabled=true row checks the box).
  const [inApp, setInApp] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState<Record<string, boolean>>({});
  const [telegram, setTelegram] = useState<Record<string, boolean>>({});
  const [, start] = useTransition();
  const [loading, setLoading] = useState(true);

  // Tier 1 expanded by default; Tiers 2 & 3 collapsed.
  const [open, setOpen] = useState<Record<number, boolean>>({
    1: true,
    2: false,
    3: false,
  });

  useEffect(() => {
    listNotificationPrefs()
      .then((rows) => {
        const a: Record<string, boolean> = {};
        const e: Record<string, boolean> = {};
        const tg: Record<string, boolean> = {};
        for (const r of rows) {
          if (r.channel === "in_app") a[r.kind] = r.enabled;
          else if (r.channel === "email") e[r.kind] = r.enabled;
          else if (r.channel === "telegram") tg[r.kind] = r.enabled;
        }
        setInApp(a);
        setEmail(e);
        setTelegram(tg);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function persist(channel: Channel, kind: string, next: boolean) {
    return setNotificationPref({ kind, channel, enabled: next });
  }

  function toggle(channel: Channel, kind: string, next: boolean) {
    const setter =
      channel === "in_app"
        ? setInApp
        : channel === "email"
          ? setEmail
          : setTelegram;
    setter((p) => ({ ...p, [kind]: next }));
    start(async () => {
      try {
        await persist(channel, kind, next);
      } catch (err) {
        setter((p) => ({ ...p, [kind]: !next }));
        toast.error((err as Error).message);
      }
    });
  }

  // External per-event delivery is gated by the master toggle AND by having a
  // channel that can deliver. When either is off, BOTH external columns grey
  // out (visual + interaction); the in-app column is never affected.
  const externalActive = notifyPerEvent && channelAvailable;
  const emailDisabled = !externalActive;
  const telegramDisabled = !externalActive || !linked;

  // Telegram checked state for a kind: explicit row wins, else tiered default.
  // This is THE UI half of the honest-wiring invariant — the dispatcher uses
  // the identical `prefRow?.enabled ?? defaultExternalOn(kind)` fallback.
  const telegramChecked = (kind: string) =>
    telegram[kind] ?? defaultExternalOn(kind);

  // Per-tier TELEGRAM bulk state, recomputed whenever a cell changes.
  function tierTelegramState(kinds: KindConfig[]): TriState {
    let on = 0;
    for (const k of kinds) if (telegramChecked(k.kind)) on += 1;
    if (on === 0) return "none";
    if (on === kinds.length) return "all";
    return "mixed";
  }

  // Bulk-toggle every kind in a tier for the TELEGRAM channel.  Optimistic:
  // flip all locally, then persist each; on ANY failure roll the whole tier
  // back to its prior snapshot and surface a toast.
  function bulkToggleTier(kinds: KindConfig[], next: boolean) {
    const snapshot = { ...telegram };
    setTelegram((p) => {
      const out = { ...p };
      for (const k of kinds) out[k.kind] = next;
      return out;
    });
    start(async () => {
      try {
        await Promise.all(
          kinds.map((k) => persist("telegram", k.kind, next)),
        );
      } catch (err) {
        setTelegram(snapshot);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-3" aria-busy={loading}>
      {KIND_TIERS.map((group) => (
        <TierSection
          key={group.tier}
          group={group}
          expanded={open[group.tier] ?? false}
          onToggleExpanded={() =>
            setOpen((p) => ({ ...p, [group.tier]: !(p[group.tier] ?? false) }))
          }
          telegramState={tierTelegramState(group.kinds)}
          onBulkTelegram={(next) => bulkToggleTier(group.kinds, next)}
          inAppOn={(kind) => inApp[kind] !== false}
          emailOn={(kind) => email[kind] === true}
          telegramOn={telegramChecked}
          emailDisabled={emailDisabled}
          telegramDisabled={telegramDisabled}
          onToggleCell={toggle}
        />
      ))}
    </div>
  );
}

function TierSection({
  group,
  expanded,
  onToggleExpanded,
  telegramState,
  onBulkTelegram,
  inAppOn,
  emailOn,
  telegramOn,
  emailDisabled,
  telegramDisabled,
  onToggleCell,
}: {
  group: { tier: number; title: string; defaultExternalOn: boolean; kinds: KindConfig[] };
  expanded: boolean;
  onToggleExpanded: () => void;
  telegramState: TriState;
  onBulkTelegram: (next: boolean) => void;
  inAppOn: (kind: string) => boolean;
  emailOn: (kind: string) => boolean;
  telegramOn: (kind: string) => boolean;
  emailDisabled: boolean;
  telegramDisabled: boolean;
  onToggleCell: (channel: Channel, kind: string, next: boolean) => void;
}) {
  // Collapsed summary so a folded tier still tells the truth about its default.
  const summary = group.defaultExternalOn ? "default on" : "default off";
  // Bulk control is "checked" when the tier is all-on; "mixed" renders the
  // indeterminate state.  Toggling targets the opposite of the current majority:
  // from all-on -> off, otherwise -> on.
  const bulkChecked = telegramState === "all";
  const bulkIndeterminate = telegramState === "mixed";

  return (
    <div className="rounded-xl border border-hairline bg-[color:var(--surface)] overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 border-b border-hairline">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          <ChevronRight
            className={`size-3.5 text-fg-faint transition-transform shrink-0 ${
              expanded ? "rotate-90" : ""
            }`}
            aria-hidden
          />
          <span className="mono-meta-sm text-fg-faint tracking-widest truncate">
            TIER {group.tier} · {group.title.toUpperCase()}
          </span>
          {!expanded ? (
            <span className="mono-meta-sm text-fg-faint">({summary})</span>
          ) : null}
        </button>
        {/* Per-tier TELEGRAM bulk toggle. */}
        <label
          className={`flex items-center gap-2 select-none ${
            telegramDisabled ? "opacity-50" : "cursor-pointer"
          }`}
          title="Toggle Telegram for every event in this tier"
        >
          <span className="mono-meta-sm text-fg-faint">TELEGRAM</span>
          <input
            type="checkbox"
            aria-label={`Telegram: all of Tier ${group.tier} (${group.title})`}
            checked={bulkChecked}
            ref={(el) => {
              if (el) el.indeterminate = bulkIndeterminate;
            }}
            disabled={telegramDisabled}
            onChange={() => onBulkTelegram(!bulkChecked)}
            className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg disabled:cursor-not-allowed"
          />
        </label>
      </div>

      {expanded ? (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2 border-b border-hairline mono-meta-sm text-fg-faint">
            <span>EVENT</span>
            <span className="w-16 text-center">IN-APP</span>
            <span className="w-16 text-center">EMAIL</span>
            <span className="w-16 text-center">TELEGRAM</span>
          </div>
          {group.kinds.map((k) => (
            <div
              key={k.kind}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 border-t border-hairline first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block text-sm text-fg font-medium">
                  {k.label}
                </span>
                <span className="block mono-meta-sm text-fg-faint">
                  {k.desc}
                </span>
              </span>
              <span className="w-16 flex justify-center">
                <input
                  type="checkbox"
                  aria-label={`In-app: ${k.label}`}
                  checked={inAppOn(k.kind)}
                  onChange={(e) =>
                    onToggleCell("in_app", k.kind, e.target.checked)
                  }
                  className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg"
                />
              </span>
              <span
                className={`w-16 flex justify-center ${
                  emailDisabled ? "opacity-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Email: ${k.label}`}
                  checked={emailOn(k.kind)}
                  disabled={emailDisabled}
                  onChange={(e) =>
                    onToggleCell("email", k.kind, e.target.checked)
                  }
                  className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg disabled:cursor-not-allowed"
                />
              </span>
              <span
                className={`w-16 flex justify-center ${
                  telegramDisabled ? "opacity-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Telegram: ${k.label}`}
                  checked={telegramOn(k.kind)}
                  disabled={telegramDisabled}
                  onChange={(e) =>
                    onToggleCell("telegram", k.kind, e.target.checked)
                  }
                  className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg disabled:cursor-not-allowed"
                />
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
