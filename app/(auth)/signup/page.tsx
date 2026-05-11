import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="relative min-h-dvh flex flex-col">
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="text-fg font-semibold">Trinno</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">SIGNUP</span>
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <section className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
              Create account
            </h1>
            <p className="text-sm text-fg-muted">
              Internal team workspace. You will land in the app right after.
            </p>
          </div>

          <SignupForm />

          <div className="pt-4 border-t border-hairline">
            <p className="text-sm text-fg-muted">
              Already have one?{" "}
              <Link
                href="/login"
                className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
              >
                Sign in
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
