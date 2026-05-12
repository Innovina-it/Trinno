# Session Configuration

## JWT Expiry

Supabase JWT expiry is configured in the **Supabase Dashboard**, not in code.

**Path:** Dashboard → Project → Settings → Authentication → JWT Settings → JWT expiry

**Recommendation:** Set JWT expiry to **28800 seconds (8 hours)**.

This is a reasonable balance between security and convenience for a team product
where users work long shifts. Supabase will silently rotate the token via the
refresh-token flow as long as the client stays active.

## Middleware — `getUser()` vs `getSession()`

Per the [Supabase Next.js SSR guide](https://supabase.com/docs/guides/auth/server-side/nextjs),
the middleware **must** call `supabase.auth.getUser()` rather than
`supabase.auth.getSession()`.

- `getSession()` reads the JWT from the cookie **without re-validating it with
  the Supabase server**. It can return a stale or spoofed token.
- `getUser()` sends the JWT to the Supabase Auth server for cryptographic
  verification and token refresh on every request.

The current `lib/supabase/middleware.ts` already calls `getUser()` — this is
correct and should be preserved.

## Refresh Flow

When `getUser()` detects that the access token has expired (but the refresh
token is still valid), Supabase SSR automatically issues a new token pair and
writes the updated cookies via the `setAll` handler. No manual refresh logic
is needed in the app.

## Checklist for extending session lifetime

1. Go to Supabase Dashboard → Settings → Authentication → JWT Settings.
2. Set **JWT expiry** to `28800` (8 h) or higher.
3. Optionally extend **Refresh token reuse interval** to match.
4. Click **Save**.
5. No code deployment required — the change takes effect immediately for new
   sign-ins; existing sessions use their current token until it expires.
