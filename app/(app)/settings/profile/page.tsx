import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link href="/settings" className="hover:text-fg">SETTINGS</Link>
          <span>/</span>
          <span className="text-fg">PROFILE</span>
        </div>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
          Profile
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">IDENTITY</h2>
        <dl className="rounded-xl border border-hairline bg-[color:var(--surface)] divide-y divide-hairline overflow-hidden">
          <Row label="Email">{user.email ?? ""}</Row>
          <Row label="User ID">
            <code className="mono-meta-sm text-fg-faint break-all">
              {user.id}
            </code>
          </Row>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">SECURITY</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-2">
          <p className="text-sm text-fg-muted">
            Password and email changes are managed through the auth provider.
            Recovery flows arrive in a later release.
          </p>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3">
      <dt className="mono-meta-sm text-fg-faint self-start pt-0.5">
        {label.toUpperCase()}
      </dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}
