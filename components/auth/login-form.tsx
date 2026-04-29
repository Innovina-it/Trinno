"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    router.replace("/");
    router.refresh();
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
        <Input id="password" type="password" required value={password}
               onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="w-full transition-all duration-150 ease-out hover:shadow-md active:scale-[0.98]"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            Log in
            <ArrowRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
