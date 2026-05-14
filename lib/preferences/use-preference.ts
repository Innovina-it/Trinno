"use client";

import { useCallback } from "react";

import { useUserPreferences } from "@/lib/preferences/provider";
import { type Preferences } from "@/lib/preferences/types";

type PreferenceSetter<K extends keyof Preferences> = (
  value: Preferences[K] | ((current: Preferences[K]) => Preferences[K]),
) => void;

export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], PreferenceSetter<K>] {
  const { preferences, setPreferences } = useUserPreferences();

  const setPreference = useCallback<PreferenceSetter<K>>(
    (value) => {
      setPreferences((current) => {
        const nextValue =
          typeof value === "function"
            ? (value as (current: Preferences[K]) => Preferences[K])(
                current[key],
              )
            : value;
        return { [key]: nextValue } as Partial<Preferences>;
      });
    },
    [key, setPreferences],
  );

  return [preferences[key], setPreference];
}
