import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="bg-auth-paper relative min-h-screen overflow-hidden">
      {/* Top marginalia strip — workspace-agnostic route metadata */}
      <div className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <span className="mono-meta text-ink/70">
            TRINNOVINA <span className="text-ink/30">/</span>{" "}
            <span className="text-ink/50">AUTH</span>{" "}
            <span className="text-ink/30">/</span>{" "}
            <span className="text-ink">LOGIN</span>
          </span>
          <span className="mono-meta-sm text-ink/40 hidden sm:inline">
            VOL. 01 — ISSUE 04 / 29
          </span>
        </div>
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-12">
        {/* Hero side — oversized italic serif */}
        <section className="lg:col-span-7 space-y-6">
          <span className="mono-meta text-ink/50 block">No. 01 — Returning</span>
          <h1 className="serif-display text-[clamp(4rem,12vw,8rem)] text-ink">
            Sign in.
          </h1>
          <p className="max-w-md text-ink/70 leading-relaxed">
            Pick up where the work left off. Boards, lists, and cards remain
            exactly as you set them down.
          </p>
          <div className="rule mt-10 w-24" />
          <p className="mono-meta text-ink/40">
            Editorial · Industrial · Kanban
          </p>
        </section>

        {/* Form side */}
        <section className="lg:col-span-5">
          <div className="border border-ink bg-paper p-7 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
              <h2 className="mono-meta text-ink">Credentials</h2>
              <span className="mono-meta-sm text-ink/40">FORM-A</span>
            </div>
            <LoginForm />
          </div>

          {/* Footer pull-quote linking to signup */}
          <div className="mt-8 text-center">
            <p className="serif-display text-2xl text-ink/80 italic">
              &ldquo;New here?&rdquo;
            </p>
            <Link
              href="/signup"
              className="mono-meta mt-2 inline-block text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-signal hover:text-signal"
            >
              Create an account &rarr;
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
