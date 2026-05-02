"use client";
import type { RefObject } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus } from "lucide-react";
import type { Zoom } from "@/lib/roadmap/dates";

export const ZOOMS: Zoom[] = ["week", "month", "quarter"];
export type LaneMode = "epic" | "assignee" | "component";
export const LANE_MODES: LaneMode[] = ["epic", "assignee", "component"];
export const LANE_MODE_LABEL: Record<LaneMode, string> = {
  epic: "By epic",
  assignee: "By assignee",
  component: "By component",
};

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
  queryDraft: string;
  onQueryDraftChange: (s: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpenShortcuts: () => void;
  gridStart: Date;
  gridEnd: Date;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="roadmap-zoom"
            className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
          >
            ZOOM: {zoom.toUpperCase()}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={zoom}
              onValueChange={(v) => onSetZoom(v as Zoom)}
            >
              {ZOOMS.map((z) => (
                <DropdownMenuRadioItem key={z} value={z}>
                  {z[0].toUpperCase() + z.slice(1)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="roadmap-lanes"
            className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
          >
            LANES: {LANE_MODE_LABEL[laneMode].toUpperCase()}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
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
        <span
          className="inline-flex items-center gap-1.5 mono-meta-sm text-fg-faint"
          data-testid="roadmap-live"
          data-live={subscribed ? "true" : "false"}
          title={subscribed ? "Realtime sync active" : "Realtime sync offline"}
        >
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              subscribed
                ? "bg-emerald-400 animate-pulse"
                : "bg-fg/20"
            }`}
          />
          {subscribed ? "LIVE" : "OFFLINE"}
        </span>
        <button
          type="button"
          onClick={onToggleCriticalPath}
          data-testid="roadmap-critical-toggle"
          data-active={showCriticalPath ? "true" : "false"}
          aria-pressed={showCriticalPath}
          title="Highlights the longest chain of blocking dependencies — a delay on any of these pushes the project end date."
          className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
            showCriticalPath ? "ring-1 ring-fg/40" : ""
          }`}
        >
          CRITICAL PATH: {showCriticalPath ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={onToggleAutoCascade}
          data-testid="roadmap-auto-cascade-toggle"
          data-active={autoCascade ? "true" : "false"}
          aria-pressed={autoCascade}
          title="Reschedule blocked dependents after a forward target_date drag"
          className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
            autoCascade ? "ring-1 ring-fg/40" : ""
          }`}
        >
          AUTO-RESCHEDULE: {autoCascade ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={onToggleGutter}
          data-testid="roadmap-priority-gutter-toggle"
          data-active={gutter ? "true" : "false"}
          aria-pressed={gutter}
          title="Drag a bar leftward into the gutter to set its priority (P0-P4)"
          className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
            gutter ? "ring-1 ring-fg/40" : ""
          }`}
        >
          PRIORITY GUTTER: {gutter ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={() => onJumpToDate(new Date())}
          data-testid="roadmap-jump-today"
          className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
          title="Scroll to today"
        >
          TODAY
        </button>
        <input
          type="date"
          data-testid="roadmap-jump-date"
          onChange={(e) => {
            if (e.target.value) onJumpToDate(new Date(e.target.value));
          }}
          className="chip inline-flex items-center mono-meta-sm bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.08)] border-0 outline-none focus:ring-1 focus:ring-fg/40"
          title="Jump to date"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenNewCard}
          data-testid="roadmap-new-card-trigger"
          className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
        >
          <Plus className="size-3" />
          NEW CARD
        </button>
        <input
          ref={searchInputRef}
          type="search"
          value={queryDraft}
          onChange={(e) => onQueryDraftChange(e.target.value)}
          placeholder="Search bars…"
          aria-label="Search roadmap"
          data-testid="roadmap-search"
          className="rounded-md border border-hairline bg-transparent px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:border-fg/40 w-44"
        />
        <button
          type="button"
          onClick={onOpenShortcuts}
          data-testid="roadmap-shortcuts-trigger"
          aria-label="Keyboard shortcuts"
          className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
        >
          ?
        </button>
        <span className="mono-meta-sm text-fg-faint">
          {gridStart.toISOString().slice(0, 10)} →{" "}
          {gridEnd.toISOString().slice(0, 10)}
        </span>
      </div>
    </div>
  );
}
