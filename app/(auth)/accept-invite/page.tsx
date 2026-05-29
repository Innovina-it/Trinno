import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <main className="relative min-h-dvh flex flex-col">
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="text-fg font-semibold">Trinno</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">ACCEPT INVITE</span>
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <section className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
              Welcome — set your password
            </h1>
            <p className="text-sm text-fg-muted">
              Choose a password of at least 8 characters to join your workspace.
            </p>
          </div>

          <AcceptInviteForm />

          <div className="pt-4 border-t border-hairline">
            <p className="text-sm text-fg-muted">
              <Link
                href="/login"
                className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
