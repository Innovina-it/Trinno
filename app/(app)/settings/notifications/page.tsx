import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { EmailDigestToggle } from "@/components/settings/email-digest-toggle";
import { getEmailDigestPref } from "@/actions/user-notification-prefs";

const KIND_DESCRIPTIONS: Array<{ kind: string; label: string; desc: string }> = [
  { kind: "comment.mention", label: "Mentions", desc: "Someone @mentions you in a comment." },
  { kind: "comment.create", label: "Comments on watched cards", desc: "New comment on a card you watch." },
  { kind: "card.assigned", label: "Assigned to you", desc: "Card assignment changes for you." },
  { kind: "card.due", label: "Due dates", desc: "Cards you watch reach their due date." },
  { kind: "card.dates", label: "Roadmap reschedules", desc: "Watched card start or target date moves." },
  { kind: "card.archived", label: "Archive activity", desc: "Cards you watch are archived or restored." },
  { kind: "card.completed", label: "Completions", desc: "Cards you watch are marked complete." },
  { kind: "board.member.added", label: "Board membership", desc: "You are added to a board." },
];

export default async function NotificationSettingsPage() {
  await requireUser();
  const digestOptin = await getEmailDigestPref();
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
        <h2 className="mono-meta-sm text-fg-faint">DELIVERY</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-3">
          <PrefRow
            id="in-app"
            label="In-app"
            desc="Bell badge + inbox row. Always on."
            checked
            disabled
          />
          <PrefRow
            id="email-instant"
            label="Email each event"
            desc="Sends an email per notification. Off by default to avoid noise."
          />
          <EmailDigestToggle initial={digestOptin} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">EVENTS</h2>
        <NotificationPrefsForm kinds={KIND_DESCRIPTIONS} />
      </section>

      <p className="mono-meta-sm text-fg-faint">
        In-app toggles persist immediately.  Email delivery is not wired yet.
      </p>
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
