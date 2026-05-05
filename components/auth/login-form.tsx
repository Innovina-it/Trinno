"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendlyAuthError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login")) {
    return "That email and password did not match.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email before signing in. Check your inbox.";
  }
  if (lower.includes("rate")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return msg;
}

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const fromQuery = sp.get("error");
    if (fromQuery) setErr(friendlyAuthError(fromQuery));
  }, [sp]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setErr(friendlyAuthError(error.message));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  function onPasswordKeyEvent(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState("CapsLock"));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 w-full" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (err) setErr(null);
          }}
          aria-invalid={err ? "true" : undefined}
          placeholder="name@example.com"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          {capsLock && (
            <span className="mono-meta-sm text-[color:var(--status-blocked)]">
              CAPS LOCK ON
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            onKeyUp={onPasswordKeyEvent}
            onKeyDown={onPasswordKeyEvent}
            aria-invalid={err ? "true" : undefined}
            placeholder="Your password"
            className="pr-10"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            {showPassword ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {err && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-[color:var(--status-blocked)]/40 bg-[color:var(--status-blocked)]/10 px-3 py-2 text-sm"
          style={{ color: "var(--status-blocked)" }}
        >
          {err}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>Signing in</span>
          </>
        ) : (
          <>
            <span>Log in</span>
            <ChevronRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
