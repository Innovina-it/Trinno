import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { InviteHero } from "@/components/auth/invite-hero";
import { HERO_VARIANT_COUNT } from "@/components/auth/hero-animation";
import { createSupabaseServer } from "@/lib/supabase/server";

export default async function LoginPage() {
  // Already-authenticated users land here from cross-tab `signed-in`
  // broadcasts that trigger `router.refresh()` on peer tabs. Send them
  // to the app shell so peer tabs leave the login screen without any
  // client-side navigation hop.
  const supa = await createSupabaseServer();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (user) redirect("/");

  // Pick one of the four hero animations per request. The page is already
  // dynamic (it reads auth cookies above), so this re-rolls on every load; the
  // chosen variant arrives in the markup, so there is no hydration mismatch.
  // The overlay only shows while "A service of Innovina.it" is hovered.
  const heroVariant = Math.floor(Math.random() * HERO_VARIANT_COUNT);

  return (
    <main className="relative min-h-dvh flex flex-col">
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="text-fg font-semibold">Trinno</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">LOGIN</span>
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-12 px-6 py-16">
        <InviteHero animationVariant={heroVariant} />

        <section className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
              Sign in
            </h1>
            <p className="text-sm text-fg-muted">
              Use the email and password you set up.
            </p>
          </div>

          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <div className="pt-4 border-t border-hairline space-y-1.5">
            <p className="text-sm text-fg-muted">
              No account?{" "}
              <Link
                href="/signup"
                className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
              >
                Create one
              </Link>
              .
            </p>
            <p className="text-sm text-fg-muted">
              Forgot password?{" "}
              <Link
                href="/forgot-password"
                className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
              >
                Reset it
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
