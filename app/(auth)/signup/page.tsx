import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Floating abstract shapes mirrored vs. login */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-32 size-[30rem] opacity-50 float-soft"
        viewBox="0 0 200 200"
      >
        <defs>
          <linearGradient id="ring2" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff2bd6" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="92" fill="none" stroke="url(#ring2)" strokeWidth="1" />
        <circle cx="100" cy="100" r="55" fill="none" stroke="url(#ring2)" strokeWidth="0.5" />
      </svg>
      <svg
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 size-[28rem] opacity-40 float-soft"
        style={{ animationDelay: "-3s" }}
        viewBox="0 0 200 200"
      >
        <defs>
          <radialGradient id="blob2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="90" ry="85" fill="url(#blob2)" />
      </svg>
      <svg
        aria-hidden
        className="pointer-events-none absolute top-1/4 left-1/3 size-32 opacity-50 float-soft"
        style={{ animationDelay: "-5s" }}
        viewBox="0 0 100 100"
      >
        <polygon
          points="50,10 90,80 10,80"
          fill="none"
          stroke="#ffb020"
          strokeWidth="1"
          strokeOpacity="0.55"
          strokeLinejoin="round"
        />
      </svg>

      <div className="relative border-b border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="gradient-text-static font-semibold">TRINNOVINA</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">SIGNUP</span>
          </span>
          <span className="mono-meta-sm text-fg-faint hidden sm:inline">
            VOL. 01 — ISSUE 04 / 29
          </span>
        </div>
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl grid-cols-1 items-center gap-10 px-6 py-16 lg:grid-cols-12">
        <section className="lg:col-span-7 space-y-8">
          <span className="chip">No. 02 — Newcomer</span>
          <h1 className="serif-display text-[clamp(4rem,12vw,8rem)] leading-[0.95]">
            <span className="text-fg/90">Create</span>
            <br />
            <span className="gradient-text">account.</span>
          </h1>
          <p className="max-w-md text-fg-muted leading-relaxed text-lg">
            Open a fresh studio. Workspaces, boards, lists, cards — built from
            the first pixel up, with realtime collaboration baked in.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <span className="block h-px w-16 bg-gradient-to-r from-accent-cyan via-accent-magenta to-accent-violet" />
            <p className="mono-meta text-fg-faint">Studio · Realtime · Kanban</p>
          </div>
        </section>

        <section className="lg:col-span-5">
          <div className="glass-strong rounded-2xl p-7 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="mb-6 flex items-baseline justify-between border-b border-hairline pb-3">
              <h2 className="mono-meta text-fg">Registration</h2>
              <span className="chip">FORM-B</span>
            </div>
            <SignupForm />
          </div>

          <div className="mt-8 text-center">
            <p className="serif-display text-2xl text-fg-muted italic">
              &ldquo;Already on file?&rdquo;
            </p>
            <Link
              href="/login"
              className="mono-meta mt-3 inline-flex items-center gap-2 text-fg transition-colors duration-200 hover:gradient-text-static"
            >
              Log in &rarr;
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
