import Link from "next/link";
import { Bell, ChevronRight, User } from "lucide-react";
import { requireUser } from "@/lib/auth";

export default async function SettingsIndexPage() {
  const user = await requireUser();
  const sections = [
    {
      href: "/settings/profile",
      label: "Profile",
      sub: user.email,
      Icon: User,
    },
    {
      href: "/settings/notifications",
      label: "Notifications",
      sub: "Email digest + per-kind preferences",
      Icon: Bell,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1 border-b border-hairline pb-4">
        <span className="mono-meta-sm text-fg-faint">SETTINGS</span>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
          Account
        </h1>
      </header>

      <ul
        className="rounded-xl border border-hairline divide-y divide-hairline overflow-hidden"
        data-testid="settings-list"
      >
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex items-center gap-3 px-4 py-3 bg-[color:var(--surface)] hover:bg-[color:var(--surface-strong)] transition-colors group/row"
            >
              <s.Icon className="size-4 text-fg-muted shrink-0" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-fg">
                  {s.label}
                </span>
                <span className="block mono-meta-sm text-fg-faint truncate">
                  {s.sub}
                </span>
              </span>
              <ChevronRight className="size-4 text-fg-faint group-hover/row:text-fg transition-colors" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
