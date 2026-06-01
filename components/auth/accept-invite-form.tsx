"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { inviteWorkspaceRedirect } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendly(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("password")) return "Password must be at least 8 characters.";
  if (lower.includes("session") || lower.includes("token")) {
    return "Invite link expired or already used. Ask the workspace admin to resend it.";
  }
  return msg;
}

export function AcceptInviteForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    async function init() {
      // Supabase admin invite links (inviteUserByEmail) verify server-side and
      // redirect here with the session in the URL *hash* (implicit flow). The
      // @supabase/ssr browser client uses PKCE and does NOT auto-consume that
      // hash, so we parse it and establish the session explicitly. Fall back to
      // any existing session (e.g. a code-flow callback already ran).
      const raw = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(raw);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supa.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) {
          // Drop the tokens from the URL so a reload can't replay them.
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
          return;
        }
      }
      const { data } = await supa.auth.getSession();
      if (!data.session) {
        setErr("Invite link expired or invalid. Ask the admin to resend it.");
      }
    }
    void init();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      setErr(friendly(error.message));
      return;
    }
    const wsId = await inviteWorkspaceRedirect();
    router.replace(wsId ? `/w/${wsId}` : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 w-full" noValidate>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            aria-invalid={err ? "true" : undefined}
            placeholder="At least 8 characters"
            className="pr-10"
            autoFocus
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide" : "Show"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
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

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>Saving</span>
          </>
        ) : (
          <>
            <span>Set password &amp; join</span>
            <ChevronRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
