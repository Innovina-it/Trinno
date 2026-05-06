import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { seedDemoWorkspaceImpl } from "@/actions/seed";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Preserve the browser's origin (Host header) so LAN clients accessing
  // the dev server via the host's LAN IP get redirected back to that IP,
  // not to localhost. Next dev sometimes resolves req.url against its own
  // bind host; the Host header carries the URL the browser actually used.
  const host = req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const browserOrigin = `${proto}://${host}`;
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
        new URL(`/login?error=${encodeURIComponent(error.message)}`, browserOrigin)
      );
    }
    token = data.session?.access_token;
  } else {
    // No PKCE code — auto-confirm path. Validate the freshly-set
    // session cookies via getUser() (server roundtrip), THEN extract the
    // token. Matches the pattern in lib/auth.ts:13-19 and avoids
    // accepting forged/replayed cookies that getSession() would decode
    // locally without auth-server validation.
    const { data: userData } = await supa.auth.getUser();
    if (!userData.user) {
      return NextResponse.redirect(new URL("/login", browserOrigin));
    }
    const { data: sessData } = await supa.auth.getSession();
    if (!sessData.session) {
      return NextResponse.redirect(new URL("/login", browserOrigin));
    }
    token = sessData.session.access_token;
  }

  // Plan #16b-γ-B (#6) — if the signup form set `tr_seed_demo=1`, populate
  // a demo workspace using the freshly minted session token then redirect
  // straight into it. Cookie is consumed exactly once. Failure to seed
  // should not block the user from reaching the app — log and fall through
  // to the default redirect so they at least land on /.
  const cookieStore = await cookies();
  const seedCookie = cookieStore.get("tr_seed_demo")?.value;
  // "1" → full demo seed (real users).  "minimal" → workspace only
  // (e2e tests opt in to a clean slate).  Anything else → no seed.
  const seedMode: "demo" | "minimal" | null =
    seedCookie === "1" ? "demo" : seedCookie === "minimal" ? "minimal" : null;
  let seededWsId: string | null = null;
  if (seedMode) {
    cookieStore.delete("tr_seed_demo");
    if (token) {
      try {
        const r = await seedDemoWorkspaceImpl(token, { mode: seedMode });
        seededWsId = r.workspaceId;
      } catch (e) {
        // Surface to server logs; user still gets into the app.
        console.error("[auth/callback] seedDemoWorkspace failed", e);
      }
    }
  }

  const dest = seededWsId ? `/w/${seededWsId}` : "/";
  return NextResponse.redirect(new URL(dest, browserOrigin));
}
