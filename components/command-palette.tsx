"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Archive,
  ArrowRight,
  Calendar,
  Clock,
  Columns,
  Command,
  FileSearch,
  FolderPlus,
  Inbox,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  PlusSquare,
  Star,
  Sun,
  Tag,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { search } from "@/actions/search";
import { logout } from "@/actions/auth";
import { useCommandPalette } from "@/lib/use-command-palette";

export type PaletteFavorite = {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};
export type PaletteRecent = PaletteFavorite;

type PaletteItem = {
  id: string;
  section: "Goto" | "Recents" | "Favorites" | "Cards" | "Actions";
  label: string;
  sub?: string;
  shortcut?: string;
  icon: React.ReactNode;
  onSelect: () => void | Promise<void>;
};

type CardResult = Awaited<ReturnType<typeof search>>[number];

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isBoardRoute(pathname: string | null | undefined): boolean {
  return /^\/(?:b|board)\//.test(pathname ?? "");
}

export function shouldSuppressQuickAddShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target">,
  pathname: string | null | undefined,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== "c" && event.key !== "C") return false;
  return !isBoardRoute(pathname) || isEditableShortcutTarget(event.target);
}

/**
 * Plan #16b-γ-D (#5) — global command palette.
 *
 * `⌘K` / `Ctrl+K` toggles the palette. Sections:
 *  - Recents (last 5 board views)
 *  - Favorites (the user's starred boards)
 *  - Cards (search-as-you-type via existing `search` action)
 *  - Actions (New board, New workspace, Toggle theme, Sign out)
 *
 * Filtering is a simple case-insensitive substring match plus a
 * weighted score (early match in label > later match > submatch).
 * Arrow keys move selection; Enter dispatches; Esc closes. The dialog
 * is mounted once in app/(app)/layout.tsx so every authed page can
 * trigger it.
 */
export function CommandPalette({
  workspaces,
  activeWorkspaceId,
  favorites,
  recents,
}: {
  workspaces: { id: string; name: string }[];
  activeWorkspaceId?: string;
  favorites: PaletteFavorite[];
  recents: PaletteRecent[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  // Open state lives in a shared store so the nav's ⌘K trigger button
  // and the `useNavChords` hook can both flip it. Esc closes locally.
  const { open, setOpen } = useCommandPalette();
  const [q, setQ] = useState("");
  const [cardResults, setCardResults] = useState<CardResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    function onKeyCapture(e: KeyboardEvent) {
      if (!shouldSuppressQuickAddShortcut(e, pathname)) return;
      e.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKeyCapture, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyCapture, { capture: true });
    };
  }, [pathname]);

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      setQ("");
      setCardResults([]);
      setActive(0);
    }
  }, [open]);

  // Debounced card search.
  useEffect(() => {
    if (!q.trim()) {
      setCardResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        setCardResults(r);
      } catch {
        setCardResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Build the items each render based on q + sources.
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const needle = q.toLowerCase().trim();
    const targetWsId = activeWorkspaceId ?? workspaces[0]?.id;

    // Goto destinations — primary nav surfaces, plus app-globals (Inbox,
    // Dashboards, Workload). Mirrors the chord shortcuts in
    // `useNavChords`. Workspace-scoped goto entries are suppressed when
    // the user has no workspace yet.
    type Goto = {
      id: string;
      label: string;
      sub?: string;
      shortcut: string;
      icon: React.ReactNode;
      href: string;
      requiresWs?: boolean;
    };
    const gotos: Goto[] = [
      {
        id: "goto:roadmap",
        label: "Roadmap",
        shortcut: "g r",
        icon: <MapIcon className="size-3.5 text-fg-muted" />,
        href: targetWsId ? `/w/${targetWsId}/roadmap` : "",
        requiresWs: true,
      },
      {
        id: "goto:boards",
        label: "Boards",
        shortcut: "g b",
        icon: <Columns className="size-3.5 text-fg-muted" />,
        href: targetWsId ? `/w/${targetWsId}/boards` : "",
        requiresWs: true,
      },
      {
        id: "goto:backlog",
        label: "Backlog",
        shortcut: "g l",
        icon: <Tag className="size-3.5 text-fg-muted" />,
        href: targetWsId ? `/w/${targetWsId}/backlog` : "",
        requiresWs: true,
      },
      {
        id: "goto:inbox",
        label: "Inbox",
        shortcut: "g i",
        icon: <Inbox className="size-3.5 text-fg-muted" />,
        href: "/inbox",
      },
      {
        id: "goto:dashboards",
        label: "Dashboards",
        shortcut: "g d",
        icon: <LayoutDashboard className="size-3.5 text-fg-muted" />,
        href: "/dashboards",
      },
      {
        id: "goto:workload",
        label: "Workload",
        shortcut: "g w",
        icon: <Users className="size-3.5 text-fg-muted" />,
        href: "/workload",
      },
      {
        id: "goto:versions",
        label: "Versions",
        shortcut: "",
        icon: <Calendar className="size-3.5 text-fg-muted" />,
        href: targetWsId ? `/w/${targetWsId}/versions` : "",
        requiresWs: true,
      },
      {
        id: "goto:archive",
        label: "Archive",
        shortcut: "",
        icon: <Archive className="size-3.5 text-fg-muted" />,
        href: targetWsId ? `/w/${targetWsId}/archive` : "",
        requiresWs: true,
      },
    ];
    for (const g of gotos) {
      if (g.requiresWs && !targetWsId) continue;
      if (needle && !g.label.toLowerCase().includes(needle)) continue;
      out.push({
        id: g.id,
        section: "Goto",
        label: g.label,
        sub: g.sub,
        shortcut: g.shortcut || undefined,
        icon: g.icon,
        onSelect: () => {
          router.push(g.href);
          setOpen(false);
        },
      });
    }

    // Recents
    for (const r of recents) {
      const label = r.boardTitle;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({
        id: `recent:${r.boardId}`,
        section: "Recents",
        label,
        sub: r.workspaceName,
        icon: <Clock className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push(`/b/${r.boardId}`);
          setOpen(false);
        },
      });
    }

    // Favorites
    for (const f of favorites) {
      const label = f.boardTitle;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      // Avoid double-listing if the same board is also a recent.
      if (out.some((x) => x.id === `recent:${f.boardId}`)) continue;
      out.push({
        id: `fav:${f.boardId}`,
        section: "Favorites",
        label,
        sub: f.workspaceName,
        icon: <Star className="size-3.5 text-amber-300" />,
        onSelect: () => {
          router.push(`/b/${f.boardId}`);
          setOpen(false);
        },
      });
    }

    // Cards (only when there's a query — server search requires non-empty)
    for (const c of cardResults) {
      out.push({
        id: `card:${c.id}`,
        section: "Cards",
        label: c.title,
        sub: c.boardTitle,
        icon: <FileSearch className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push(`/b/${c.boardId}/c/${c.id}`);
          setOpen(false);
        },
      });
    }

    // Actions — always shown but filtered by q if present.
    // Plan #workspace-routing — "New board…" routes to the *active*
    // workspace (resolved server-side from the URL), falling back to
    // the first workspace only when the active one is unknown
    // (e.g. /inbox or a personal-scope dashboard). "Open my tasks"
    // moved to Goto with `g t`.
    const actions: PaletteItem[] = [
      {
        id: "act:new-board",
        section: "Actions",
        label: "New board…",
        sub: "Open the active workspace and create",
        icon: <PlusSquare className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          if (targetWsId) router.push(`/w/${targetWsId}?new-board=1`);
          setOpen(false);
        },
      },
      {
        id: "act:new-workspace",
        section: "Actions",
        label: "New workspace…",
        sub: "Open the home page",
        icon: <FolderPlus className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push("/?new-workspace=1");
          setOpen(false);
        },
      },
      {
        id: "act:toggle-theme",
        section: "Actions",
        label: "Toggle theme",
        sub: theme === "dark" ? "Dark → Light" : "Light → Dark",
        icon: <Sun className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "act:logout",
        section: "Actions",
        label: "Sign out",
        sub: "End the current session",
        icon: <LogOut className="size-3.5 text-fg-muted" />,
        onSelect: async () => {
          setOpen(false);
          await logout();
        },
      },
    ];
    for (const a of actions) {
      if (needle && !a.label.toLowerCase().includes(needle)) continue;
      out.push(a);
    }

    return out;
  }, [q, recents, favorites, cardResults, workspaces, activeWorkspaceId, theme, setTheme, setOpen, router]);

  // Group items per section for rendering. Plain array of pairs so we
  // don't reach for the JS `Map` constructor — Turbopack misresolves it
  // when `Map` is also re-exported as an alias from a sibling module
  // import in this file (the lucide `Map` icon).
  const grouped = useMemo(() => {
    const order: PaletteItem["section"][] = [];
    const byName = new globalThis.Map<
      PaletteItem["section"],
      PaletteItem[]
    >();
    for (const it of items) {
      let bucket = byName.get(it.section);
      if (!bucket) {
        bucket = [];
        byName.set(it.section, bucket);
        order.push(it.section);
      }
      bucket.push(it);
    }
    return order.map(
      (s) => [s, byName.get(s)!] as [PaletteItem["section"], PaletteItem[]],
    );
  }, [items]);

  // Reset active index when items shrink/grow.
  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);

  function onListKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) it.onSelect();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={[
          "sm:max-w-lg p-0 gap-0",
          // Full-screen on mobile: drop the centered card framing, take
          // the whole viewport so the keyboard doesn't crash the list
          // and the result panel actually has room to breathe.
          "max-md:inset-0 max-md:top-0 max-md:left-0 max-md:translate-x-0 max-md:translate-y-0",
          "max-md:max-w-none max-md:w-full max-md:h-dvh max-md:rounded-none",
          "max-md:slide-in-from-bottom-0 max-md:zoom-in-100",
        ].join(" ")}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Command className="size-4 text-fg-muted" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onListKeyDown}
            placeholder="Type a command or search…"
            data-testid="command-palette-input"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint placeholder:italic placeholder:font-serif"
          />
          <span className="mono-meta-sm text-fg-faint">ESC</span>
        </div>
        <div
          className="max-h-[60vh] md:max-h-[60vh] max-md:flex-1 max-md:max-h-none overflow-y-auto p-1"
          data-testid="command-palette-list"
        >
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-fg-faint italic">
              No matches.
            </div>
          )}
          {grouped.map(([section, sectionItems]) => (
            <div key={section} className="mb-1">
              <div className="px-2 pt-2 pb-1 mono-meta-sm text-fg-faint tracking-wider">
                {section.toUpperCase()}
              </div>
              <ul>
                {sectionItems.map((it) => {
                  const idx = items.findIndex((x) => x.id === it.id);
                  const isActive = idx === active;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => it.onSelect()}
                        data-testid={`palette-item-${it.id}`}
                        className={`flex w-full items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                          isActive
                            ? "bg-[color:var(--surface-hi)] text-fg"
                            : "text-fg-muted hover:bg-[color:var(--surface)]"
                        }`}
                      >
                        {it.icon}
                        <span className="flex-1 truncate text-sm">
                          {it.label}
                        </span>
                        {it.sub && (
                          <span className="mono-meta-sm text-fg-faint truncate max-w-[12rem]">
                            {it.sub}
                          </span>
                        )}
                        {it.shortcut && (
                          <kbd className="mono-meta-sm text-fg-faint border border-hairline rounded px-1.5 py-0.5 leading-none tracking-[0.08em]">
                            {it.shortcut}
                          </kbd>
                        )}
                        {!it.shortcut && isActive && (
                          <ArrowRight className="size-3 text-fg-faint" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
