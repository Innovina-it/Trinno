"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getUserPreferences,
  setUserPreferences,
} from "@/actions/profile-preferences";
import { type Preferences } from "@/lib/preferences/types";

type PreferencesUpdate =
  | Partial<Preferences>
  | ((current: Preferences) => Partial<Preferences>);

type UserPreferencesContextValue = {
  preferences: Preferences;
  setPreferences: (update: PreferencesUpdate) => void;
  /** Cancel the debounce and await any pending write. Call before logout,
   *  account switch, or other auth-clearing actions so in-flight changes
   *  hit the DB while the user's JWT is still valid. */
  flushPreferences: () => Promise<void>;
};

const UserPreferencesContext =
  createContext<UserPreferencesContextValue | null>(null);

const COOKIE_MAX_AGE_YEAR = 60 * 60 * 24 * 365;

// Mirror shell-shape prefs (sidebar, density) into non-httpOnly cookies so
// the root layout can render <body data-*> attrs at SSR and avoid the
// first-paint flicker. The debounced Server Action remains the source of
// truth; cookies are a render-time hint only.
function writeShellCookieMirror(
  patch: Partial<Preferences>,
  next: Preferences,
) {
  if (typeof document === "undefined") return;

  if (Object.prototype.hasOwnProperty.call(patch, "sidebarCollapsed")) {
    if (next.sidebarCollapsed === true) {
      document.cookie = `pref_sb=1; path=/; SameSite=Lax; max-age=${COOKIE_MAX_AGE_YEAR}`;
    } else {
      document.cookie = "pref_sb=; path=/; max-age=0";
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "layoutDensity")) {
    const density = next.layoutDensity;
    if (density) {
      document.cookie = `pref_density=${density}; path=/; SameSite=Lax; max-age=${COOKIE_MAX_AGE_YEAR}`;
    }
  }
}

type UserPreferencesProviderProps = {
  children?: ReactNode;
  initial?: Preferences;
};

export function UserPreferencesProvider({
  children,
  initial,
}: UserPreferencesProviderProps) {
  const [preferences, setPreferencesState] = useState<Preferences>(
    initial ?? {},
  );
  const stateRef = useRef<Preferences>(initial ?? {});
  const pendingRef = useRef<Partial<Preferences>>({});
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0) return;

    pendingRef.current = {};
    try {
      await setUserPreferences(pending);
    } catch {
      pendingRef.current = { ...pending, ...pendingRef.current };
    }
  }, []);

  const flushPreferences = useCallback(async (): Promise<void> => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    await flushPending();
  }, [flushPending]);

  const scheduleWrite = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      void flushPending();
    }, 500);
  }, [flushPending]);

  const setPreferences = useCallback(
    (update: PreferencesUpdate) => {
      const current = stateRef.current;
      const patch = typeof update === "function" ? update(current) : update;
      const next = { ...current, ...patch };

      stateRef.current = next;
      pendingRef.current = { ...pendingRef.current, ...patch };
      setPreferencesState(next);
      writeShellCookieMirror(patch, next);
      scheduleWrite();
    },
    [scheduleWrite],
  );

  useEffect(() => {
    if (initial !== undefined) return;

    let active = true;
    void getUserPreferences().then((loaded) => {
      if (!active) return;
      stateRef.current = loaded;
      setPreferencesState(loaded);
    });

    return () => {
      active = false;
    };
  }, [initial]);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      void flushPending();
    };
  }, [flushPending]);

  // The 500ms debounce can lose writes if the user closes the tab (or the
  // whole browser) before it fires. Flush immediately when the page is
  // hidden — covers tab close, app switch, Chrome close, and phone lock.
  // pagehide is the most reliable unload signal across browsers (bfcache
  // safe); visibilitychange catches the common "user backgrounds the tab,
  // then quits Chrome from the menu" sequence.
  useEffect(() => {
    if (typeof document === "undefined") return;

    function flushNow() {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      void flushPending();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushNow();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    };
  }, [flushPending]);

  const value = useMemo(
    () => ({ preferences, setPreferences, flushPreferences }),
    [preferences, setPreferences, flushPreferences],
  );

  return createElement(
    UserPreferencesContext.Provider,
    { value },
    children,
  );
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error(
      "useUserPreferences must be used within UserPreferencesProvider",
    );
  }
  return context;
}
