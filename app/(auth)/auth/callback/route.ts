import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { seedDemoWorkspaceImpl } from "@/actions/seed";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // Plan #epic-as-kanban — auto-confirm signup path. supabase.auth.signUp
  // returns a session directly when enable_confirmations=false; the form
  // navigates here without a `code` query param solely to give us a
  // server-side hook for draining the `tr_seed_demo` cookie + running the
  // seed against the freshly-set session cookies.
  const supa = await createSupabaseServer();
  let token: string | undefined;
  if (code) {
    const { data, error } = await supa.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }
    token = data.session?.access_token;
  } else {
    const { data: sessData } = await supa.auth.getSession();
    if (!sessData.session) {
      return NextResponse.redirect(new URL("/login", url.origin));
    }
    token = sessData.session.access_token;
  }

  // Plan #16b-γ-B (#6) — if the signup form set `tr_seed_demo=1`, populate
  // a demo workspace using the freshly minted session token then redirect
  // straight into it. Cookie is consumed exactly once. Failure to seed
  // should not block the user from reaching the app — log and fall through
  // to the default redirect so they at least land on /.
  const cookieStore = await cookies();
  const wantsSeed = cookieStore.get("tr_seed_demo")?.value === "1";
  let seededWsId: string | null = null;
  if (wantsSeed) {
    cookieStore.delete("tr_seed_demo");
    if (token) {
      try {
        const r = await seedDemoWorkspaceImpl(token);
        seededWsId = r.workspaceId;
      } catch (e) {
        // Surface to server logs; user still gets into the app.
        console.error("[auth/callback] seedDemoWorkspace failed", e);
      }
    }
  }

  const dest = seededWsId ? `/w/${seededWsId}` : "/";
  return NextResponse.redirect(new URL(dest, url.origin));
}
