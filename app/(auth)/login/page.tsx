import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="bg-auth-gradient relative min-h-screen overflow-hidden p-6">
      {/* Decorative blurs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 size-80 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl"
      />
      <div className="relative grid min-h-[calc(100vh-3rem)] place-items-center">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border/60 bg-background/85 p-7 shadow-xl ring-1 ring-black/5 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
          <div className="space-y-1.5 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to continue to your boards</p>
          </div>
          <LoginForm />
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/signup" className="font-medium text-foreground underline underline-offset-4 hover:no-underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
