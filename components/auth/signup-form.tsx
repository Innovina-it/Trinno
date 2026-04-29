"use client";
import { useState } from "react";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";
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
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border/60 bg-muted/40 p-6 text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          Check your email for a confirmation link.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required minLength={8}
               value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="w-full transition-all duration-150 ease-out hover:shadow-md active:scale-[0.98]"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          <>
            Sign up
            <ArrowRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
