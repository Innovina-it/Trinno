import { createBrowserClient } from "@supabase/ssr";
import { z } from "zod";
import { publishAuthEvent } from "@/lib/auth/broadcast";

const browserEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

function getBrowserEnv() {
  return browserEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

function createSupabaseBrowserClient() {
  const env = getBrowserEnv();
  const supabase = createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  installAuthBrowserSync(supabase);

  return supabase;
}

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

type AuthStateChangeEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | string;

type BrowserAuthSession = {
  user?: {
    id?: string;
  } | null;
} | null;

type AuthBrowserSyncClient = {
  auth?: {
    getSession?: () => Promise<unknown>;
    onAuthStateChange?: (
      handler: (
        event: AuthStateChangeEvent,
        session: BrowserAuthSession,
      ) => void,
    ) => unknown;
  };
};

const STORAGE_REFRESH_THROTTLE_MS = 50 * 60 * 1000;

let isRemoteRefresh = false;
let lastRefreshAt: number | undefined;

function isSupabaseSessionStorageKey(key: string | null) {
  const normalizedKey = key?.toLowerCase() ?? "";

  return (
    normalizedKey.includes("supabase") && normalizedKey.includes("session")
  );
}

function installAuthBrowserSync(supabase: AuthBrowserSyncClient) {
  supabase.auth?.onAuthStateChange?.((event, session) => {
    if (isRemoteRefresh) {
      return;
    }

    const userId = session?.user?.id;

    if (event === "SIGNED_IN") {
      publishAuthEvent({ type: "signed-in", userId });
    } else if (event === "SIGNED_OUT") {
      publishAuthEvent({ type: "signed-out", userId });
    } else if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      publishAuthEvent({ type: "token-refreshed", userId });
    }
  });

  if (typeof window === "undefined" || !supabase.auth?.getSession) {
    return;
  }

  window.addEventListener("storage", (event) => {
    if (!isSupabaseSessionStorageKey(event.key)) {
      return;
    }

    const now = Date.now();

    if (
      lastRefreshAt !== undefined &&
      now - lastRefreshAt < STORAGE_REFRESH_THROTTLE_MS
    ) {
      return;
    }

    lastRefreshAt = now;
    isRemoteRefresh = true;

    supabase.auth
      ?.getSession?.()
      .finally(() => {
        isRemoteRefresh = false;
      });
  });
}

let browserClient: SupabaseBrowserClient | undefined;

export function createSupabaseBrowser() {
  if (!browserClient) {
    browserClient = createSupabaseBrowserClient();
  }

  return browserClient;
}
