"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { CalendarRange, ChevronDown, Plus, Check, Search, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertWorkspaceLink, removeWorkspaceLink } from "@/actions/links";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export type WorkspaceLite = { id: string; name: string };

// At >5 workspaces a flat list becomes hard to scan. A search input
// pinned to the top filters by `name.toLowerCase().includes(q)` so the
// active workspace stays one or two keystrokes away.
const SEARCH_THRESHOLD = 5;

// Subsections under `/w/{id}/...` that are workspace-agnostic and
// safe to preserve when switching workspaces. Detail routes that take
// workspace-scoped IDs (sprints/{sprintId}, versions/{versionId})
// are deliberately excluded — the ID wouldn't exist in the target
// workspace, so we drop to the section root or the workspace root.
// `settings` is also deliberately excluded: switching workspaces from
// the Manage-workspace page should drop INTO the chosen workspace's
// content (its roadmap), not pin you to the new workspace's settings.
// It's handled explicitly in `targetFor` (→ `/w/{id}/roadmap`) rather
// than falling through to the bare `/w/{id}` root, because that root is
// a server-redirect bouncer (page.tsx) — routing through it costs an
// extra round-trip and makes the switch feel sluggish.
const PRESERVED_SUBSECTIONS = new Set([
  "backlog",
  "all-tasks",
  "archive",
  "boards",
  "roadmap",
  "sprints",
  "versions",
  // `analysis` is a stable section root (no workspace-scoped detail id),
  // so it's safe to preserve like backlog/roadmap. Without it, switching
  // workspaces from /w/{id}/analysis fell through to the bare `/w/{id}`
  // server-redirect bouncer, which showed the workspace OfficeLoadingScreen
  // and — racing router.refresh() against the server redirect() — left the
  // spinner hung. Direct `/w/{newId}/analysis` skips the bounce.
  "analysis",
]);

const PERSONAL_ROUTES = [
  "/me",
  "/inbox",
  "/timeline",
  "/dashboards",
  "/workload",
] as const;

/**
 * Switch between workspaces, plus create a new one. Settings/members
 * moved out of this trigger; they live on the workspace-settings page,
 * surfaced by the command palette ("Manage workspace") and inside the
 * workspace nav. Keeping this menu narrow lets the bar feel less like
 * a command center and more like a wayfinding cue.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  activeWorkspaceLink,
  canEditWorkspaceLink,
}: {
  workspaces: WorkspaceLite[];
  activeId?: string;
  activeWorkspaceLink?: { url: string } | null;
  canEditWorkspaceLink?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [openCreate, setOpenCreate] = useState(false);
  const [q, setQ] = useState("");
  const [wsLinkOpen, setWsLinkOpen] = useState(false);

  // Personal routes (/inbox, /timeline, ...) are workspace-agnostic. This is
  // reactive via usePathname, unlike `activeId` which the (app) layout computes
  // once on the server and does NOT recompute on client-side navigation between
  // sibling pages. So after a board → /timeline client nav, `activeId` is still
  // pinned to the board's workspace; gating on the live pathname is what keeps
  // the label honest.
  const onPersonalRoute =
    !!pathname &&
    PERSONAL_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    );

  function targetFor(newId: string): string {
    // From the cross-workspace Home (/me) or the All Workspace Timeline,
    // picking a specific workspace should LEAVE that personal view and drop
    // INTO the chosen workspace's content (its roadmap by default) — not stay
    // pinned like the other workspace-agnostic personal routes.
    if (pathname === "/timeline" || pathname === "/me") {
      return `/w/${newId}`;
    }
    if (onPersonalRoute) {
      return pathname;
    }
    const m = pathname?.match(/^\/w\/[^/]+\/([^/?#]+)/);
    const sub = m?.[1];
    if (sub && PRESERVED_SUBSECTIONS.has(sub)) {
      return `/w/${newId}/${sub}`;
    }
    // Manage-workspace (settings) page: jump straight to the new workspace's
    // roadmap. The bare `/w/${newId}` root is a server-redirect bouncer
    // (page.tsx reads prefs, then redirects to roadmap/board), so reaching it
    // costs a second server round-trip + a re-run of the heavy /w layout —
    // the switch feels slow vs. switching from roadmap/board. The end state is
    // identical (roadmap); we just skip the bounce.
    if (sub === "settings") {
      return `/w/${newId}/roadmap`;
    }
    return `/w/${newId}`;
  }
  // When the URL doesn't pin a workspace (e.g. /inbox, /dashboards),
  // don't fake "active = workspaces[0]". The trigger label and the
  // in-list checkmark would lie about which workspace the user is in.
  const active =
    activeId && !onPersonalRoute
      ? workspaces.find((w) => w.id === activeId)
      : undefined;

  const showSearch = workspaces.length > SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    if (!showSearch || !q.trim()) return workspaces;
    const needle = q.toLowerCase();
    return workspaces.filter((w) => w.name.toLowerCase().includes(needle));
  }, [workspaces, q, showSearch]);

  return (
    <>
      <div className="inline-flex items-center gap-1">
      <DropdownMenu
        onOpenChange={(o) => {
          if (!o) setQ("");
        }}
      >
        <DropdownMenuTrigger
          data-testid="workspace-switcher-trigger"
          className="inline-flex items-center gap-1.5 h-8 px-2 max-w-[220px] rounded-md text-sm font-semibold tracking-tight text-fg hover:bg-[rgb(255_255_255/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
        >
          <span className="truncate">
            {active?.name ?? (pathname === "/timeline" ? "All Workspace Timelines" : "Workspaces")}
          </span>
          <ChevronDown className="size-3 text-fg-faint shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
                WORKSPACES
              </span>
            </DropdownMenuLabel>
            {showSearch && (
              <div className="px-2 pb-2">
                <div className="relative">
                  <Search
                    className="size-3.5 text-fg-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden
                  />
                  <input
                    autoFocus
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        const first = filtered.find(
                          (w) => w.id !== active?.id,
                        );
                        if (first) {
                          e.preventDefault();
                          router.push(targetFor(first.id));
                          router.refresh();
                        }
                      }
                    }}
                    placeholder="Filter workspaces…"
                    data-testid="workspace-switcher-search"
                    className="h-8 w-full rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] pl-7 pr-2 text-sm outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
                  />
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-3 mono-meta-sm text-fg-faint">
                No matches.
              </div>
            )}
            {filtered.map((w) => {
              const isActive = w.id === active?.id;
              return (
                <DropdownMenuItem
                  key={w.id}
                  onClick={() => {
                    if (!isActive) {
                      router.push(targetFor(w.id));
                      router.refresh();
                    }
                  }}
                  className={
                    isActive
                      ? "bg-[color:var(--surface-hi)] text-fg"
                      : undefined
                  }
                >
                  <span className="flex-1 truncate text-sm">{w.name}</span>
                  {isActive && <Check className="size-3.5 text-fg" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={<Link href="/timeline" />}
            data-testid="workspace-switcher-timeline"
          >
            <CalendarRange className="size-3.5" />
            <span className="text-sm">All Workspace Timelines</span>
          </DropdownMenuItem>
          {active && (
            <DropdownMenuItem
              render={<Link href={`/w/${active.id}/settings`} />}
              data-testid="workspace-switcher-manage"
            >
              <Settings className="size-3.5" />
              <span className="text-sm">Manage workspace</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            data-testid="workspace-switcher-new"
            onClick={() => setOpenCreate(true)}
          >
            <Plus className="size-3.5" />
            <span className="text-sm">New workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {active && activeWorkspaceLink?.url && (
        <>
          <LinkIcon
            variant="workspace"
            url={activeWorkspaceLink.url}
            canEdit={!!canEditWorkspaceLink}
            onEdit={() => setWsLinkOpen(true)}
          />
          {canEditWorkspaceLink && (
            <LinkEditDialog
              open={wsLinkOpen}
              onOpenChange={setWsLinkOpen}
              scope="workspace"
              initialUrl={activeWorkspaceLink.url}
              onSave={async ({ url }) => {
                const res = await upsertWorkspaceLink({
                  workspaceId: active.id,
                  url,
                });
                if (res.ok) router.refresh();
                else toast.error(res.error.message);
              }}
              onRemove={async () => {
                const res = await removeWorkspaceLink({ workspaceId: active.id });
                if (res.ok) router.refresh();
                else toast.error(res.error.message);
              }}
            />
          )}
        </>
      )}
      </div>
      <CreateWorkspaceDialog open={openCreate} onOpenChange={setOpenCreate} />
    </>
  );
}
