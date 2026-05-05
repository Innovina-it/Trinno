"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendlyAuthError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("already registered")) {
    return "That email is already registered. Sign in instead.";
  }
  if (lower.includes("password")) {
    return "Password must be at least 8 characters.";
  }
  if (lower.includes("rate")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return msg;
}

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [seedDemo, setSeedDemo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<{ email: string } | null>(null);
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function doSignup(targetEmail: string, targetPassword: string) {
    if (seedDemo) {
      document.cookie = "tr_seed_demo=1; path=/; max-age=600; samesite=lax";
    }
    const supa = createSupabaseBrowser();
    return supa.auth.signUp({
      email: targetEmail,
      password: targetPassword,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);

    const { data, error } = await doSignup(email, password);
    if (error) {
      setSubmitting(false);
      setErr(friendlyAuthError(error.message));
      return;
    }
    if (data.session) {
      const target = seedDemo ? "/auth/callback" : "/";
      window.location.replace(target);
      return;
    }
    setSubmitting(false);
    setSent({ email });
  }

  async function resend() {
    if (!sent) return;
    setResending(true);
    const { error } = await doSignup(sent.email, password);
    setResending(false);
    if (error) {
      setErr(friendlyAuthError(error.message));
      return;
    }
    setResentAt(new Date());
  }

  function editEmail() {
    setSent(null);
    setResentAt(null);
    setTimeout(() => emailRef.current?.focus(), 0);
  }

  function onPasswordKeyEvent(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState("CapsLock"));
  }

  if (sent) {
    return (
      <div
        className="rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-7 space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-200"
        data-testid="signup-sent"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-full border border-hairline-hi bg-[color:var(--surface-strong)]">
            <MailCheck className="size-5 text-fg" />
          </div>
          <h3 className="font-sans text-xl font-bold tracking-tight text-fg">
            Check your email
          </h3>
          <p className="text-sm text-fg-muted max-w-xs leading-relaxed">
            We sent a confirmation link to{" "}
            <span className="text-fg font-medium">{sent.email}</span>. Open it
            to finish creating the account.
          </p>
        </div>

        {err && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md border border-[color:var(--status-blocked)]/40 bg-[color:var(--status-blocked)]/10 px-3 py-2 text-sm text-center"
            style={{ color: "var(--status-blocked)" }}
          >
            {err}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resend}
            disabled={resending}
            className="w-full"
            data-testid="signup-resend"
          >
            {resending ? "Sending…" : "Resend email"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={editEmail}
            className="w-full"
            data-testid="signup-edit-email"
          >
            Use a different email
          </Button>
          {resentAt && (
            <span
              className="mono-meta-sm text-fg-faint text-center tabular-nums"
              aria-live="polite"
            >
              SENT AGAIN ·{" "}
              {resentAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>
    );
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
          autoComplete="email"
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            onKeyUp={onPasswordKeyEvent}
            onKeyDown={onPasswordKeyEvent}
            aria-invalid={err ? "true" : undefined}
            placeholder="At least 8 characters"
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

      <label className="flex items-start gap-2.5 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={seedDemo}
          onChange={(e) => setSeedDemo(e.target.checked)}
          className="mt-0.5 size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface)] accent-fg"
        />
        <span className="text-sm text-fg-muted leading-snug">
          Seed a demo workspace so I can explore right away.
        </span>
      </label>

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
            <span>Creating account</span>
          </>
        ) : (
          <>
            <span>Sign up</span>
            <ChevronRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
