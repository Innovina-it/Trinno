"use client";
import { useState } from "react";
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
      <p className="text-sm text-muted-foreground">
        Check your email for a confirmation link.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-sm">
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
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating account…" : "Sign up"}
      </Button>
    </form>
  );
}
