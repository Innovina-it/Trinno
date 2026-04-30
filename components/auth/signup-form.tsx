"use client";
import { useState } from "react";
import { ChevronRight, Loader2, MailCheck } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="glass rounded-2xl flex flex-col items-center gap-4 p-7 text-center animate-in fade-in slide-in-from-bottom-1 duration-200">
        <div className="relative flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-accent-cyan via-accent-magenta to-accent-violet text-white shadow-[0_8px_24px_-8px_rgb(139_92_246/0.6)]">
          <span className="absolute inset-[2px] rounded-full bg-[color:var(--bg-1)] flex items-center justify-center">
            <MailCheck className="size-5 text-fg" />
          </span>
        </div>
        <h3 className="serif-display gradient-text-static text-3xl">
          Check your email.
        </h3>
        <p className="mono-meta-sm text-fg-muted max-w-xs leading-relaxed">
          We sent a confirmation link to your inbox. Click it to activate your
          studio account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 w-full">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8+ characters"
        />
      </div>
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
            <ChevronRight className="size-4 text-signal transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
