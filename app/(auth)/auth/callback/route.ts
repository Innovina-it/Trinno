import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { seedDemoWorkspaceImpl } from "@/actions/seed";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", url.origin));

  const supa = await createSupabaseServer();
  const { data, error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    );
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
    const token = data.session?.access_token;
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
