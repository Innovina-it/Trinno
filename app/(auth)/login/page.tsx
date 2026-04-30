import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Floating abstract shapes — low opacity, drift slowly. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 size-[28rem] opacity-50 float-soft"
        viewBox="0 0 200 200"
      >
        <defs>
          <linearGradient id="ring1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="90" fill="none" stroke="url(#ring1)" strokeWidth="1" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="url(#ring1)" strokeWidth="0.5" />
      </svg>
      <svg
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-24 size-[32rem] opacity-40 float-soft"
        style={{ animationDelay: "-4s" }}
        viewBox="0 0 200 200"
      >
        <defs>
          <radialGradient id="blob1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff2bd6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ff2bd6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="95" ry="80" fill="url(#blob1)" />
      </svg>
      <svg
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-1/4 size-40 opacity-60 float-soft"
        style={{ animationDelay: "-2s" }}
        viewBox="0 0 100 100"
      >
        <path
          d="M10 60 Q 30 20, 50 60 T 90 60"
          stroke="#c3f73a"
          strokeWidth="1.5"
          strokeOpacity="0.55"
          fill="none"
          strokeLinecap="round"
        />
      </svg>

      {/* Top marginalia strip */}
      <div className="relative border-b border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="gradient-text-static font-semibold">TRINNOVINA</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">LOGIN</span>
          </span>
          <span className="mono-meta-sm text-fg-faint hidden sm:inline">
            VOL. 01 — ISSUE 04 / 29
          </span>
        </div>
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl grid-cols-1 items-center gap-10 px-6 py-16 lg:grid-cols-12">
        <section className="lg:col-span-7 space-y-8">
          <span className="chip">No. 01 — Returning</span>
          <h1 className="serif-display text-[clamp(4rem,12vw,8rem)] leading-[0.95]">
            <span className="gradient-text">Welcome</span>
            <br />
            <span className="text-fg/90">back.</span>
          </h1>
          <p className="max-w-md text-fg-muted leading-relaxed text-lg">
            Pick up where the work left off. Boards, lists, and cards remain
            exactly as you set them down — every cursor, every comment, in sync.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <span className="block h-px w-16 bg-gradient-to-r from-accent-cyan via-accent-magenta to-accent-violet" />
            <p className="mono-meta text-fg-faint">Studio · Realtime · Kanban</p>
          </div>
        </section>

        {/* Form side — glass card */}
        <section className="lg:col-span-5">
          <div className="glass-strong rounded-2xl p-7 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="mb-6 flex items-baseline justify-between border-b border-hairline pb-3">
              <h2 className="mono-meta text-fg">Credentials</h2>
              <span className="chip">FORM-A</span>
            </div>
            <LoginForm />
          </div>

          <div className="mt-8 text-center">
            <p className="serif-display text-2xl text-fg-muted italic">
              &ldquo;New here?&rdquo;
            </p>
            <Link
              href="/signup"
              className="mono-meta mt-3 inline-flex items-center gap-2 text-fg transition-colors duration-200 hover:gradient-text-static"
            >
              Create an account &rarr;
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
