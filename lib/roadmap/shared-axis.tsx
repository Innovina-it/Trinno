"use client";
/**
 * SharedAxisProvider — shared horizontal time axis across stacked RoadmapView
 * instances on /timeline (workspace timelines).
 *
 * Purpose: when N RoadmapView bands render on one page (one per workspace),
 * they must all use the same gridStart/gridEnd and stay scroll-synced so
 * "May 1" lines up vertically across bands. Zoom is already shared through
 * the URL (?zoom=). This context provides the missing two pieces:
 *
 *   1. range  — overrides each band's cards-derived gridStart/gridEnd.
 *   2. scroll — bidirectional sync between every registered scroller; scroll
 *               one band, every band tracks.
 *
 * When the context is absent (the workspace-scoped /w/:ws/roadmap route),
 * RoadmapView falls back to its native cards-derived range and owns its own
 * scroll, behaving exactly as before this provider existed.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SharedAxisRange = { start: Date; end: Date };

type JumpToDateFn = (d: Date) => void;

type SharedAxisHandle = {
  range: SharedAxisRange;
  registerScroller: (el: HTMLDivElement) => () => void;
  /** Bands register their internal jumpToDate; the page-level Today / date
   *  picker calls one and scroll-sync mirrors to peers. */
  registerJumpToDate: (fn: JumpToDateFn) => () => void;
  /** Calls the first registered band's jumpToDate. Safe no-op when no band
   *  has registered yet (initial render before any band mounts). */
  jumpToDate: (d: Date) => void;
  /** First-mounted band's scroller element. Page-level mini-map writes
   *  scrollLeft here; SharedAxis scroll-sync then mirrors it to every peer.
   *  Updates when bands mount/unmount; null until the first one registers. */
  primaryScroller: HTMLDivElement | null;
};

/** Cross-band live pixels-per-day override driven by the page-level
 *  mini-map resize handle. Split into its own context so high-frequency
 *  updates during a drag don't churn the main SharedAxisHandle identity,
 *  which would re-fire every consumer effect that lists `sharedAxis` as a
 *  dep (scroller re-registration, etc.) and trigger an update-depth loop. */
type SharedDragPpdHandle = {
  value: number | null;
  set: (v: number | null) => void;
};

const SharedAxisContext = createContext<SharedAxisHandle | null>(null);
const SharedDragPpdContext = createContext<SharedDragPpdHandle | null>(null);

export function SharedAxisProvider({
  range,
  children,
}: {
  range: SharedAxisRange;
  children: ReactNode;
}) {
  const scrollersRef = useRef(new Set<HTMLDivElement>());
  const syncingRef = useRef(false);
  const jumpFnsRef = useRef<JumpToDateFn[]>([]);
  // Re-render trigger so consumers reading `primaryScroller` from the
  // context value pick up the first registration (and any change as bands
  // mount/unmount). The scroller itself is stored in the Set; this state
  // just snapshots which one is "first".
  const [primaryScroller, setPrimaryScroller] =
    useState<HTMLDivElement | null>(null);
  const [dragPpdOverride, setDragPpdOverride] = useState<number | null>(null);

  const registerScroller = useCallback((el: HTMLDivElement) => {
    scrollersRef.current.add(el);
    // Functional update: avoids capturing a stale primaryScroller in this
    // callback's closure. If the band that registered now happens to be
    // the only one in the set, it becomes primary.
    setPrimaryScroller((prev) => prev ?? el);
    const onScroll = () => {
      // Guard against the cascade we trigger ourselves: writing peer.scrollLeft
      // fires their scroll handler in the next microtask. Without the flag,
      // 5 bands would loop forever ping-ponging single-pixel rounding drift.
      if (syncingRef.current) return;
      syncingRef.current = true;
      const left = el.scrollLeft;
      for (const peer of scrollersRef.current) {
        if (peer !== el && peer.scrollLeft !== left) peer.scrollLeft = left;
      }
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Snap newcomers to the current consensus position so a late-mounting
    // band doesn't sit at scrollLeft=0 while the others have scrolled.
    const first = scrollersRef.current.values().next().value;
    if (first && first !== el) el.scrollLeft = first.scrollLeft;
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollersRef.current.delete(el);
      // Functional update reads the latest primary at the moment cleanup
      // fires — otherwise this closure captures the value at register time
      // and may miss subsequent swaps.
      setPrimaryScroller((prev) =>
        prev === el
          ? (scrollersRef.current.values().next().value ?? null)
          : prev,
      );
    };
  }, []);

  const registerJumpToDate = useCallback((fn: JumpToDateFn) => {
    jumpFnsRef.current.push(fn);
    return () => {
      jumpFnsRef.current = jumpFnsRef.current.filter((x) => x !== fn);
    };
  }, []);

  const jumpToDate = useCallback((d: Date) => {
    const fn = jumpFnsRef.current[0];
    if (fn) fn(d);
  }, []);

  const value = useMemo<SharedAxisHandle>(
    () => ({
      range,
      registerScroller,
      registerJumpToDate,
      jumpToDate,
      primaryScroller,
    }),
    [
      range,
      registerScroller,
      registerJumpToDate,
      jumpToDate,
      primaryScroller,
    ],
  );

  // Stable setter (useState setters are stable). Wrapping the live value in
  // a separate memo keeps identity churn isolated from `value` above.
  const dragValue = useMemo<SharedDragPpdHandle>(
    () => ({ value: dragPpdOverride, set: setDragPpdOverride }),
    [dragPpdOverride],
  );

  return (
    <SharedAxisContext.Provider value={value}>
      <SharedDragPpdContext.Provider value={dragValue}>
        {children}
      </SharedDragPpdContext.Provider>
    </SharedAxisContext.Provider>
  );
}

export function useSharedAxis(): SharedAxisHandle | null {
  return useContext(SharedAxisContext);
}

/** Subscribe to the cross-band drag-ppd override. Returns null outside a
 *  SharedAxisProvider. */
export function useSharedDragPpd(): SharedDragPpdHandle | null {
  return useContext(SharedDragPpdContext);
}

/**
 * Register a scroller element with the surrounding SharedAxisProvider, if any.
 * No-op when no provider is mounted (workspace-scoped roadmap route).
 */
export function useRegisterSharedScroller(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
) {
  const axis = useSharedAxis();
  useEffect(() => {
    const el = scrollerRef.current;
    if (!axis || !el) return;
    return axis.registerScroller(el);
  }, [axis, scrollerRef]);
}
