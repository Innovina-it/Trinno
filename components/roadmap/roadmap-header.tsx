"use client";
import type { RefObject } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  GripVertical,
  HelpCircle,
  Layers,
  Plus,
  Search,
  Settings2,
  ZoomIn,
} from "lucide-react";
import type { Zoom } from "@/lib/roadmap/dates";

export const ZOOMS: Zoom[] = ["week", "month", "quarter"];
export type LaneMode = "epic" | "assignee" | "component";
export const LANE_MODES: LaneMode[] = ["epic", "assignee", "component"];
export const LANE_MODE_LABEL: Record<LaneMode, string> = {
  epic: "By epic",
  assignee: "By assignee",
  component: "By component",
};
const ZOOM_LABEL: Record<Zoom, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function RoadmapHeader({
  zoom,
  onSetZoom,
  laneMode,
  onSetLaneMode,
  subscribed,
  showCriticalPath,
  onToggleCriticalPath,
  autoCascade,
  onToggleAutoCascade,
  gutter,
  onToggleGutter,
  onJumpToDate,
  onOpenNewCard,
  onChipDragStart,
  queryDraft,
  onQueryDraftChange,
  searchInputRef,
  onOpenShortcuts,
  gridStart,
  gridEnd,
}: {
  zoom: Zoom;
  onSetZoom: (z: Zoom) => void;
  laneMode: LaneMode;
  onSetLaneMode: (m: LaneMode) => void;
  subscribed: boolean;
  showCriticalPath: boolean;
  onToggleCriticalPath: () => void;
  autoCascade: boolean;
  onToggleAutoCascade: () => void;
  gutter: boolean;
  onToggleGutter: () => void;
  onJumpToDate: (d: Date) => void;
  onOpenNewCard: () => void;
  onChipDragStart?: (clientX: number, clientY: number) => void;
  queryDraft: string;
  onQueryDraftChange: (s: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpenShortcuts: () => void;
  gridStart: Date;
  gridEnd: Date;
}) {
  const viewOptionsCount =
    (showCriticalPath ? 1 : 0) + (autoCascade ? 1 : 0) + (gutter ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* LEFT — view controls */}
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="roadmap-zoom"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
          >
            <ZoomIn className="size-3.5" aria-hidden />
            <span className="text-fg">{ZOOM_LABEL[zoom]}</span>
            <ChevronDown className="size-3 text-fg-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Zoom</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={zoom}
              onValueChange={(v) => onSetZoom(v as Zoom)}
            >
              {ZOOMS.map((z) => (
                <DropdownMenuRadioItem key={z} value={z}>
                  {ZOOM_LABEL[z]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="roadmap-lanes"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
          >
            <Layers className="size-3.5" aria-hidden />
            <span className="text-fg">{LANE_MODE_LABEL[laneMode]}</span>
            <ChevronDown className="size-3 text-fg-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group lanes</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={laneMode}
              onValueChange={(v) => onSetLaneMode(v as LaneMode)}
            >
              {LANE_MODES.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {LANE_MODE_LABEL[m]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View options — collapses critical path / auto-reschedule / gutter. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="roadmap-view-options"
            data-active={viewOptionsCount > 0 ? "true" : "false"}
            title="Critical path, auto-reschedule, priority gutter"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] ${
              viewOptionsCount > 0
                ? "border-fg/40 bg-fg/10 text-fg"
                : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
            }`}
          >
            <Settings2 className="size-3.5" aria-hidden />
            <span className="text-fg">View</span>
            {viewOptionsCount > 0 && (
              <span
                aria-label={`${viewOptionsCount} options enabled`}
                className="inline-flex items-center justify-center rounded-full bg-fg text-bg-deep size-4 text-[10px] font-semibold tabular-nums"
              >
                {viewOptionsCount}
              </span>
            )}
            <ChevronDown className="size-3 text-fg-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>View options</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={showCriticalPath}
                onCheckedChange={onToggleCriticalPath}
                data-testid="roadmap-critical-toggle"
              >
                Critical path
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={autoCascade}
                onCheckedChange={onToggleAutoCascade}
                data-testid="roadmap-auto-cascade-toggle"
              >
                Auto-reschedule
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={gutter}
                onCheckedChange={onToggleGutter}
                data-testid="roadmap-priority-gutter-toggle"
              >
                Priority gutter
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* CENTER — search */}
      <div className="flex-1 flex justify-center min-w-[10rem]">
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-faint pointer-events-none"
            aria-hidden
          />
          <input
            ref={searchInputRef}
            type="search"
            value={queryDraft}
            onChange={(e) => onQueryDraftChange(e.target.value)}
            placeholder="Search bars…"
            aria-label="Search roadmap"
            data-testid="roadmap-search"
            className="w-full rounded-full border border-hairline bg-[color:var(--surface)] pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:border-fg/40"
          />
        </div>
      </div>

      {/* RIGHT — date jump + primary action + help */}
      <div className="flex items-center gap-1.5">
        {/* Date jump compound control. */}
        <div className="inline-flex items-stretch rounded-full border border-hairline bg-[color:var(--surface)] divide-x divide-hairline overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => onJumpToDate(new Date())}
            data-testid="roadmap-jump-today"
            className="px-3 py-1.5 hover:bg-[rgb(255_255_255/0.08)] text-fg"
            title="Scroll to today"
          >
            Today
          </button>
          <label
            className="inline-flex items-center pl-2 pr-2 hover:bg-[rgb(255_255_255/0.08)] cursor-pointer"
            title="Jump to date"
          >
            <CalendarDays className="size-3.5 text-fg-faint" aria-hidden />
            <input
              type="date"
              data-testid="roadmap-jump-date"
              onChange={(e) => {
                if (e.target.value) onJumpToDate(new Date(e.target.value));
              }}
              className="ml-1 w-[7rem] bg-transparent border-0 outline-none text-fg text-xs"
            />
          </label>
        </div>

        {/* Primary action. */}
        <button
          type="button"
          onPointerDown={
            onChipDragStart
              ? (e) => {
                  if (e.button !== 0) return;
                  onChipDragStart(e.clientX, e.clientY);
                }
              : undefined
          }
          onClick={onChipDragStart ? undefined : onOpenNewCard}
          data-testid="roadmap-new-card-trigger"
          title="Click or drag onto roadmap to create"
          className="shimmer-cta inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none"
        >
          <GripVertical
            className="size-3 text-bg-deep/50"
            aria-hidden
          />
          <Plus className="size-3.5" />
          <span>New card</span>
        </button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          data-testid="roadmap-shortcuts-trigger"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          className="inline-flex items-center justify-center rounded-full size-8 border border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </div>

      {/* Ambient status — separate row, lighter weight than the action toolbar. */}
      <div className="basis-full flex items-center justify-between gap-3 px-1 text-fg-faint">
        <span
          className="inline-flex items-center gap-1.5 mono-meta-sm"
          data-testid="roadmap-live"
          data-live={subscribed ? "true" : "false"}
          title={subscribed ? "Realtime sync active" : "Realtime sync offline"}
        >
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              subscribed ? "bg-emerald-400 animate-pulse" : "bg-fg/30"
            }`}
          />
          {subscribed ? "Live" : "Offline"}
        </span>
        <span className="inline-flex items-center gap-1.5 mono-meta-sm tabular-nums">
          <CalendarClock className="size-3" aria-hidden />
          {fmtDate(gridStart)} → {fmtDate(gridEnd)}
        </span>
      </div>
    </div>
  );
}
