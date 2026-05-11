"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { openCommandPalette } from "@/lib/use-command-palette";

const CHORD_WINDOW_MS = 1500;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Vim-style nav chords. Press `g` followed by one of:
 *   r → roadmap
 *   b → boards
 *   l → backlog
 *   t → my tasks (all-tasks)
 *   i → inbox
 *   d → dashboards
 *   w → workload
 *
 * Plus global accelerators:
 *   ⌘K / Ctrl+K → command palette
 *   /          → command palette (search-focused)
 *
 * No-ops while typing in form controls.
 */
export function useNavChords({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    let primed = false;
    let primeTimer: ReturnType<typeof setTimeout> | null = null;

    function clearPrime() {
      primed = false;
      if (primeTimer) {
        clearTimeout(primeTimer);
        primeTimer = null;
      }
    }

    function go(path: string) {
      router.push(path);
    }

    function onKey(e: KeyboardEvent) {
      // Palette accelerator. Allowed even when typing — users expect ⌘K
      // to open from anywhere; the palette steals focus.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `/` opens the palette focused on search.
      if (e.key === "/" && !primed) {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      if (!primed) {
        if (e.key === "g" || e.key === "G") {
          primed = true;
          primeTimer = setTimeout(clearPrime, CHORD_WINDOW_MS);
        }
        return;
      }

      // Primed → second-key dispatch.
      const k = e.key.toLowerCase();
      let path: string | null = null;
      if (k === "r" && workspaceId) path = `/w/${workspaceId}/roadmap`;
      else if (k === "b" && workspaceId) path = `/w/${workspaceId}/boards`;
      else if (k === "l" && workspaceId) path = `/w/${workspaceId}/backlog`;
      else if (k === "t" && workspaceId) path = `/w/${workspaceId}/all-tasks`;
      else if (k === "i") path = `/inbox`;
      else if (k === "d") path = `/dashboards`;
      else if (k === "w") path = `/workload`;

      if (path) {
        e.preventDefault();
        go(path);
      }
      clearPrime();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPrime();
    };
  }, [router, workspaceId]);
}
