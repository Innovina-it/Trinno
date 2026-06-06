import Link from "next/link";
import { eq } from "drizzle-orm";
import { getSessionToken, requireUser } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { userChannelLinks } from "@/lib/db/schema";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { EmailDigestToggle } from "@/components/settings/email-digest-toggle";
import { NotifyPerEventToggle } from "@/components/settings/notify-per-event-toggle";
import { TelegramConnect } from "@/components/settings/telegram-connect";
import { TelegramDigestToggle } from "@/components/settings/telegram-digest-toggle";
import {
  getEmailDigestPref,
  getNotifyPerEvent,
  listNotificationPrefs,
} from "@/actions/user-notification-prefs";
import { hasExternalDeliveryChannel } from "@/lib/notifications/channels/availability";

type TelegramStatus = "linked" | "pending" | "none";

// Read the current user's telegram link row (user_channel_links, channel
// 'telegram') and normalize it to a tri-state status + the captured @handle for
// the UI. No row -> none; handle is null until a /start link records it.
async function getTelegramStatus(): Promise<{
  status: TelegramStatus;
  handle: string | null;
}> {
  const t = (await getSessionToken())!;
  return dbAsUser(t, async (tx) => {
    const [row] = await tx
      .select({
        status: userChannelLinks.status,
        handle: userChannelLinks.handle,
      })
      .from(userChannelLinks)
      .where(eq(userChannelLinks.channel, "telegram"));
    if (!row) return { status: "none" as const, handle: null };
    return {
      status: (row.status === "linked" ? "linked" : "pending") as TelegramStatus,
      handle: row.handle ?? null,
    };
  });
}

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const [
    digestOptin,
    notifyPerEvent,
    channelAvailable,
    telegram,
    prefs,
  ] = await Promise.all([
    getEmailDigestPref(),
    getNotifyPerEvent(),
    hasExternalDeliveryChannel(user.id),
    getTelegramStatus(),
    listNotificationPrefs(),
  ]);

  const telegramStatus = telegram.status;
  const telegramHandle = telegram.handle;
  const telegramLinked = telegramStatus === "linked";
  const telegramDigestOptin =
    prefs.find(
      (p) => p.kind === "digest.daily" && p.channel === "telegram",
    )?.enabled ?? false;

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 md:px-6 py-6 md:py-8 space-y-6">
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link href="/settings" className="hover:text-fg">SETTINGS</Link>
          <span>/</span>
          <span className="text-fg">NOTIFICATIONS</span>
        </div>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
          Notifications
        </h1>
        <p className="text-sm text-fg-muted">
          Notifications appear in the bell and at <Link href="/inbox" className="underline underline-offset-4 decoration-hairline-hi hover:decoration-fg">/inbox</Link>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">CHANNELS</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-3">
          <ChannelRow label="In-app" detail="Always on">
            <span className="mono-meta-sm text-fg-faint">Locked</span>
          </ChannelRow>
          <ChannelRow
            label="Email"
            detail={user.email ?? ""}
          >
            <span className="mono-meta-sm text-fg-faint">delivery not active</span>
          </ChannelRow>
          <ChannelRow
            label="Telegram"
            detail={
              telegramLinked
                ? telegramHandle
                  ? `@${telegramHandle} · Connected`
                  : "Connected"
                : telegramStatus === "pending"
                  ? "Link pending"
                  : "Not connected"
            }
          >
            <TelegramConnect status={telegramStatus} handle={telegramHandle} />
          </ChannelRow>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">DELIVERY</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-3">
          <PrefRow
            id="in-app"
            label="In-app"
            desc="Bell badge + inbox row. Always on."
            checked
            disabled
          />
          <NotifyPerEventToggle
            initial={notifyPerEvent}
            channelAvailable={channelAvailable}
          />
          <EmailDigestToggle initial={digestOptin} />
          <TelegramDigestToggle
            initial={telegramDigestOptin}
            linked={telegramLinked}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">EVENTS</h2>
        <NotificationPrefsForm
          notifyPerEvent={notifyPerEvent}
          channelAvailable={channelAvailable}
          linked={telegramLinked}
        />
      </section>

      <p className="mono-meta-sm text-fg-faint">
        In-app toggles persist immediately.  Email delivery is not wired yet.
      </p>
    </div>
  );
}

function ChannelRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-fg font-medium">{label}</span>
        <span className="block mono-meta-sm text-fg-faint truncate">{detail}</span>
      </span>
      {children}
    </div>
  );
}

function PrefRow({
  id,
  label,
  desc,
  checked = false,
  disabled = false,
  flush = false,
}: {
  id: string;
  label: string;
  desc: string;
  checked?: boolean;
  disabled?: boolean;
  flush?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-3 cursor-pointer select-none ${
        flush ? "px-4 py-3" : ""
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        id={id}
        type="checkbox"
        defaultChecked={checked}
        disabled={disabled}
        className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-fg font-medium">{label}</span>
        <span className="block mono-meta-sm text-fg-faint">{desc}</span>
      </span>
    </label>
  );
}
