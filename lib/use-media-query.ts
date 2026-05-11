"use client";

import { useCallback, useSyncExternalStore } from "react";

// SSR-safe media query hook. The server snapshot is always `false` so the
// initial render matches the client's first render before matchMedia has
// settled — React would otherwise flag a hydration mismatch on any
// component that branched on a viewport state.
//
// Callers that NEED the truthy branch on first paint (e.g. avoiding a
// flash of the wrong layout) should render both branches and let CSS
// hide the wrong one, not gate on this hook alone.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      // `change` covers every browser shipped in the last decade. Older
      // Safari requires addListener; modern ones support addEventListener.
      // The shape below works on both because we never call `removeListener`
      // when we used `addEventListener` and vice versa.
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", notify);
        return () => mql.removeEventListener("change", notify);
      }
      mql.addListener(notify);
      return () => mql.removeListener(notify);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
