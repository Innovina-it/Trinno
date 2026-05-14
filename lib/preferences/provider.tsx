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
};

const UserPreferencesContext =
  createContext<UserPreferencesContextValue | null>(null);

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

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0) return;

    pendingRef.current = {};
    void setUserPreferences(pending).catch(() => {
      pendingRef.current = { ...pending, ...pendingRef.current };
    });
  }, []);

  const scheduleWrite = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      flushPending();
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
    };
  }, []);

  const value = useMemo(
    () => ({ preferences, setPreferences }),
    [preferences, setPreferences],
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
