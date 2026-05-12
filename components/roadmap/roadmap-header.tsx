"use client";
import { useState, type RefObject } from "react";
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
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
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
  Sliders,
  ZoomIn,
} from "lucide-react";
import type { Zoom } from "@/lib/roadmap/dates";
import { formatDate } from "@/lib/format-date";

export const ZOOMS: Zoom[] = ["fit", "week", "month", "quarter"];
export type LaneMode = "epic" | "assignee" | "component";
export const LANE_MODES: LaneMode[] = ["epic", "assignee", "component"];
export const LANE_MODE_LABEL: Record<LaneMode, string> = {
  epic: "By epic",
  assignee: "By assignee",
  component: "By component",
};
// Task 6 — primary view-mode toggle. "gantt" is the historical bar
// timeline; "list" is the new flat hierarchical view ordered by
// startDate ASC. URL parameter `?view=list` activates it; default stays
// absent from the URL so existing deep-links keep working.
export type ViewMode = "gantt" | "list";
export const VIEW_MODES: ViewMode[] = ["gantt", "list"];
export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  gantt: "Gantt",
  list: "List",
};
const ZOOM_LABEL: Record<Zoom, string> = {
  fit: "Fit",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

export function RoadmapHeader({
  zoom,
  onSetZoom,
  laneMode,
  onSetLaneMode,
  viewMode,
  onSetViewMode,
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
  // Task 6 — primary view mode (gantt | list). Owned by RoadmapView and
  // URL-synced via `?view=list`.
  viewMode: ViewMode;
  onSetViewMode: (m: ViewMode) => void;
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

  // <md: every left-zone control (zoom, lane mode, view options, jump-to-
  // date) collapses behind a single Display pill. The BottomSheet houses
  // the same setters with simple inline radio/checkbox rows so the
  // operator doesn't juggle four nested dropdowns on a phone.
  const [displaySheetOpen, setDisplaySheetOpen] = useState(false);

  // Lightweight inline rows used inside the mobile Display sheet.
  // Each value renders as a 44px-min row so touch tap-areas stay honest.
  function SheetRadioRow<T extends string>({
    name,
    value,
    options,
    onChange,
  }: {
    name: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
  }) {
    return (
      <div role="radiogroup" aria-label={name} className="space-y-1">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(o.value)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 rounded-xl min-h-11 text-sm transition-colors",
                checked
                  ? "bg-[color:var(--surface-hi)] text-fg"
                  : "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg",
              )}
            >
              <span>{o.label}</span>
              {checked && (
                <span aria-hidden className="size-1.5 rounded-full bg-fg" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function SheetCheckRow({
    label,
    checked,
    onChange,
    testId,
  }: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    testId?: string;
  }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          "w-full flex items-center justify-between gap-3 px-3 rounded-xl min-h-11 text-sm transition-colors",
          checked
            ? "bg-[color:var(--surface-hi)] text-fg"
            : "text-fg-muted hover:bg-[color:var(--surface-strong)] hover:text-fg",
        )}
      >
        <span>{label}</span>
        <span
          aria-hidden
          className={cn(
            "relative inline-flex items-center w-8 h-5 rounded-full border transition-colors",
            checked
              ? "bg-fg border-fg"
              : "bg-[color:var(--surface)] border-hairline-hi",
          )}
        >
          <span
            className={cn(
              "absolute size-3.5 rounded-full transition-transform",
              checked
                ? "translate-x-3 bg-bg-deep"
                : "translate-x-0.5 bg-fg-muted",
            )}
          />
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* MOBILE — single Display pill collapses zoom + lane + view options
          + jump-to-date into one BottomSheet. Idle UI stays grayscale per
          DESIGN.md Idle Mute Rule. */}
      <button
        type="button"
        onClick={() => setDisplaySheetOpen(true)}
        data-testid="roadmap-display-sheet-trigger"
        aria-haspopup="dialog"
        aria-expanded={displaySheetOpen}
        className="md:hidden inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-3 py-1.5 text-xs text-fg hover:bg-[rgb(255_255_255/0.08)] [@media(hover:none)_and_(pointer:coarse)]:min-h-11"
      >
        <Sliders className="size-3.5" aria-hidden />
        <span>Display</span>
        {viewOptionsCount > 0 && (
          <span
            aria-label={`${viewOptionsCount} view options enabled`}
            className="inline-flex items-center justify-center rounded-full bg-fg text-bg-deep size-4 text-[10px] font-semibold tabular-nums"
          >
            {viewOptionsCount}
          </span>
        )}
      </button>
      <BottomSheet
        open={displaySheetOpen}
        onOpenChange={setDisplaySheetOpen}
        title="Display"
        description="Zoom, lane grouping, view options, and date jump."
      >
        <div className="space-y-5">
          {/* Task 6 — view mode (gantt | list) lives at the top of the
              mobile Display sheet for parity with desktop. */}
          <section>
            <p className="mono-meta-sm text-fg-faint tracking-[0.14em] px-3 pb-1">
              VIEW
            </p>
            <SheetRadioRow
              name="View mode"
              value={viewMode}
              options={VIEW_MODES.map((m) => ({
                value: m,
                label: VIEW_MODE_LABEL[m],
              }))}
              onChange={(next) => onSetViewMode(next)}
            />
          </section>
          <section>
            <p className="mono-meta-sm text-fg-faint tracking-[0.14em] px-3 pb-1">
              ZOOM
            </p>
            <SheetRadioRow
              name="Zoom"
              value={zoom}
              options={ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] }))}
              onChange={(next) => onSetZoom(next)}
            />
          </section>
          <section>
            <p className="mono-meta-sm text-fg-faint tracking-[0.14em] px-3 pb-1">
              GROUP LANES
            </p>
            <SheetRadioRow
              name="Group lanes"
              value={laneMode}
              options={LANE_MODES.map((m) => ({
                value: m,
                label: LANE_MODE_LABEL[m],
              }))}
              onChange={(next) => onSetLaneMode(next)}
            />
          </section>
          <section>
            <p className="mono-meta-sm text-fg-faint tracking-[0.14em] px-3 pb-1">
              VIEW OPTIONS
            </p>
            <div className="space-y-1">
              <SheetCheckRow
                label="Critical path"
                checked={showCriticalPath}
                onChange={onToggleCriticalPath}
                testId="roadmap-critical-toggle-sheet"
              />
              <SheetCheckRow
                label="Auto-reschedule"
                checked={autoCascade}
                onChange={onToggleAutoCascade}
                testId="roadmap-auto-cascade-toggle-sheet"
              />
              <SheetCheckRow
                label="Priority gutter"
                checked={gutter}
                onChange={onToggleGutter}
                testId="roadmap-priority-gutter-toggle-sheet"
              />
            </div>
          </section>
          <section>
            <p className="mono-meta-sm text-fg-faint tracking-[0.14em] px-3 pb-1">
              JUMP
            </p>
            <div className="flex gap-2 px-3">
              <button
                type="button"
                onClick={() => {
                  onJumpToDate(new Date());
                  setDisplaySheetOpen(false);
                }}
                className="flex-1 min-h-11 rounded-xl border border-hairline bg-[color:var(--surface)] text-sm text-fg hover:bg-[color:var(--surface-strong)] transition-colors"
              >
                Today
              </button>
              <label className="flex-1 inline-flex items-center gap-2 px-3 min-h-11 rounded-xl border border-hairline bg-[color:var(--surface)] hover:bg-[color:var(--surface-strong)] transition-colors cursor-pointer">
                <CalendarDays
                  className="size-3.5 text-fg-faint"
                  aria-hidden
                />
                <input
                  type="date"
                  onChange={(e) => {
                    if (e.target.value) {
                      onJumpToDate(new Date(e.target.value));
                      setDisplaySheetOpen(false);
                    }
                  }}
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-fg text-sm"
                />
              </label>
            </div>
          </section>
        </div>
      </BottomSheet>

      {/* DESKTOP LEFT — view controls (≥md) */}
      <div className="hidden md:flex items-center gap-1.5">
        {/* Task 6 — gantt / list segmented switch. Keeps the timeline as
            the default; List is a flat, date-ordered alternative for users
            who need a scannable tree rather than a horizontal canvas. */}
        <div
          role="group"
          aria-label="Roadmap view mode"
          data-testid="roadmap-view-mode"
          className="inline-flex items-stretch rounded-full border border-hairline bg-[color:var(--surface)] overflow-hidden text-xs"
        >
          {VIEW_MODES.map((m) => {
            const active = viewMode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  if (!active) onSetViewMode(m);
                }}
                data-testid={`roadmap-view-mode-${m}`}
                data-active={active ? "true" : "false"}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  active
                    ? "bg-fg text-bg-deep"
                    : "text-fg-muted hover:bg-[rgb(255_255_255/0.08)] hover:text-fg",
                )}
              >
                {VIEW_MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
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
        {/* Date jump compound control. Hidden <md: (lives inside the
            Display sheet on mobile). */}
        <div className="hidden md:inline-flex items-stretch rounded-full border border-hairline bg-[color:var(--surface)] divide-x divide-hairline overflow-hidden text-xs">
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
          {formatDate(gridStart)} → {formatDate(gridEnd)}
        </span>
      </div>
    </div>
  );
}
