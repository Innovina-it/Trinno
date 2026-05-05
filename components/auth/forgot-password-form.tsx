"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, MailCheck } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendly(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("rate")) return "Too many attempts. Wait a minute.";
  if (lower.includes("not found") || lower.includes("user")) {
    // Supabase intentionally does not disclose whether the email exists.
    // Surface a generic confirmation either way.
    return "If that email is registered, you will receive a reset link.";
  }
  return msg;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<{ email: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      setErr(friendly(error.message));
      return;
    }
    setSent({ email });
  }

  if (sent) {
    return (
      <div
        className="rounded-2xl border border-hairline-hi bg-[color:var(--popover)] p-7 text-center space-y-3"
        data-testid="forgot-sent"
      >
        <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-hairline-hi bg-[color:var(--surface-strong)]">
          <MailCheck className="size-5 text-fg" />
        </div>
        <h3 className="font-sans text-xl font-bold tracking-tight text-fg">
          Check your email
        </h3>
        <p className="text-sm text-fg-muted max-w-xs mx-auto leading-relaxed">
          If <span className="text-fg font-medium">{sent.email}</span> is
          registered, a reset link is on its way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 w-full" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          ref={ref}
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

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>Sending</span>
          </>
        ) : (
          <>
            <span>Send reset link</span>
            <ChevronRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
