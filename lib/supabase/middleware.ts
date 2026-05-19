import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public paths reachable without a session. Auth flow (login/signup/reset)
// plus the marketing index and the OAuth/email-link callback.
const PUBLIC_PATH_EXACT = new Set<string>([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/favicon.ico",
]);

const PUBLIC_PATH_PREFIX = ["/auth/", "/_next/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_EXACT.has(pathname)) return true;
  return PUBLIC_PATH_PREFIX.some((p) => pathname.startsWith(p));
}

// Cron endpoints authenticate via `Authorization: Bearer CRON_SECRET` inside
// the route handler. Skip the user-session gate so Vercel cron keeps working.
function isCronApi(pathname: string): boolean {
  return pathname.startsWith("/api/cron/");
}

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function updateSession(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (user) return res;

  const { pathname } = req.nextUrl;

  // Cron uses its own Bearer-secret auth in-handler. Pass through.
  if (isCronApi(pathname)) return res;

  // Public paths render without a session.
  if (isPublicPath(pathname)) return res;

  // Unauth API → 401 JSON (never redirect; clients can't follow).
  if (isApi(pathname)) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // Unauth page → redirect to /login carrying the original destination.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(loginUrl, 302);
}
