"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Loader2, Search, X } from "lucide-react";
import { searchProfiles } from "@/actions/profile-search";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { usePeopleCache } from "@/hooks/use-people-cache";

export type PickerProfile = {
  id: string;
  handle: string | null;
  displayName: string;
};

export type PickerSelected<R extends string = string> = PickerProfile & {
  role: R;
};

// Avatar mirrors AvatarDot in assignee-picker — same hash → same swatch
// across the app, so the picker matches mention chips and member rows.
const SWATCHES = [
  "bg-emerald-500/20 text-emerald-200",
  "bg-violet-500/20 text-violet-200",
  "bg-amber-500/20 text-amber-200",
  "bg-rose-500/20 text-rose-200",
  "bg-sky-500/20 text-sky-200",
  "bg-fuchsia-500/20 text-fuchsia-200",
];

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function swatchFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

function Avatar({
  profile,
  size = 24,
}: {
  profile: PickerProfile;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none ${swatchFor(profile.id)}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initialsOf(profile.displayName)}
    </span>
  );
}

export interface PeoplePickerProps<R extends string> {
  selected: PickerSelected<R>[];
  onSelectedChange: (next: PickerSelected<R>[]) => void;
  roleOptions: SelectOption[];
  defaultRole: R;
  /** Profile ids hidden from suggestions (e.g. already-members of the target). */
  excludeIds?: ReadonlySet<string>;
  label?: string;
  labelHint?: string;
  placeholder?: string;
  inputTestId?: string;
}

export function PeoplePicker<R extends string>({
  selected,
  onSelectedChange,
  roleOptions,
  defaultRole,
  excludeIds,
  label = "Add members",
  labelHint,
  placeholder = "Search by name, handle, or email…",
  inputTestId,
}: PeoplePickerProps<R>) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PickerProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Request-version guard — every loadSuggestions bumps this; only the
  // newest response is allowed to mutate state. Stops the slow empty-query
  // preload from clobbering a fast typed-query result.
  const reqVersion = useRef(0);
  const listboxId = useId();
  const inputId = useId();
  const focusInput = useCallback(() => {
    (document.getElementById(inputId) as HTMLInputElement | null)?.focus();
  }, [inputId]);

  useEffect(() => {
    let cancelled = false;
    createSupabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setViewerId(data.user?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { people: cachedCollaborators, hydrated: cacheHydrated } =
    usePeopleCache(viewerId);

  const loadSuggestions = useCallback(
    async (q: string) => {
      const v = ++reqVersion.current;
      const selectedIds = new Set(selected.map((p) => p.id));
      const isExcluded = (p: PickerProfile) =>
        selectedIds.has(p.id) ||
        p.id === viewerId ||
        (excludeIds?.has(p.id) ?? false);
      if (!q.trim()) {
        if (v !== reqVersion.current) return;
        setSuggestions(cachedCollaborators.filter((p) => !isExcluded(p)));
        setActiveIdx(0);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const results = await searchProfiles(q);
        if (v !== reqVersion.current) return;
        setSuggestions(results.filter((p) => !isExcluded(p)));
        setActiveIdx(0);
      } catch {
        if (v === reqVersion.current) setSuggestions([]);
      } finally {
        if (v === reqVersion.current) setSearching(false);
      }
    },
    [selected, viewerId, cachedCollaborators, excludeIds],
  );

  // Preload the empty-query suggestions once the viewer is known. Also
  // re-runs when the cache hydrates so collaborators appear without a
  // manual refresh.
  useEffect(() => {
    if (query.trim() !== "") return;
    void loadSuggestions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, cachedCollaborators, cacheHydrated]);

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      setSearching(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void loadSuggestions(value);
      }, 220);
    },
    [loadSuggestions],
  );

  function addMember(profile: PickerProfile) {
    if (selected.find((p) => p.id === profile.id)) return;
    onSelectedChange([...selected, { ...profile, role: defaultRole }]);
    setSuggestions((prev) => prev.filter((p) => p.id !== profile.id));
    setActiveIdx(0);
    focusInput();
  }

  function removeMember(id: string) {
    onSelectedChange(selected.filter((p) => p.id !== id));
  }

  function changeRole(id: string, role: R) {
    onSelectedChange(
      selected.map((p) => (p.id === id ? { ...p, role } : p)),
    );
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(suggestions.length - 1);
    } else if (e.key === "Enter") {
      const pick = suggestions[activeIdx];
      if (pick) {
        e.preventDefault();
        addMember(pick);
      }
    } else if (e.key === "Escape") {
      if (query !== "") {
        e.preventDefault();
        setQuery("");
        void loadSuggestions("");
      }
    }
  }

  const showSuggestions = useMemo(
    () => suggestions.length > 0 || (query.trim() !== "" && !searching),
    [suggestions.length, query, searching],
  );
  const noResults =
    suggestions.length === 0 && query.trim() !== "" && !searching;
  const activeOptionId = suggestions[activeIdx]
    ? `${listboxId}-opt-${suggestions[activeIdx].id}`
    : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>
        {label}
        {labelHint && <span className="text-fg-faint"> ({labelHint})</span>}
      </Label>

      {selected.length > 0 && (
        <ul
          aria-label="Selected members"
          className="space-y-1 mb-1"
          data-testid="people-picker-selected"
        >
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-[color:var(--surface)] px-2 py-1.5"
            >
              <Avatar profile={p} size={24} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-fg truncate">{p.displayName}</div>
                {p.handle && (
                  <div className="mono-meta-sm text-fg-faint truncate">
                    @{p.handle}
                  </div>
                )}
              </div>
              <Select
                value={p.role}
                onValueChange={(v) => changeRole(p.id, v as R)}
                options={roleOptions}
                size="sm"
                aria-label={`Role for ${p.displayName}`}
              />
              <button
                type="button"
                aria-label={`Remove ${p.displayName}`}
                onClick={() => removeMember(p.id)}
                className="inline-flex items-center justify-center size-7 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search
          className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden
        />
        <Input
          id={inputId}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          className="pl-9 pr-9"
          data-testid={inputTestId}
        />
        {searching && (
          <Loader2
            className="size-4 text-fg-faint absolute right-3 top-1/2 -translate-y-1/2 animate-spin pointer-events-none"
            aria-hidden
            data-testid="people-picker-searching"
          />
        )}
      </div>

      {showSuggestions && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Member suggestions"
          className="rounded-lg border border-hairline bg-[color:var(--surface)] py-1 text-sm max-h-56 overflow-y-auto"
        >
          {suggestions.map((p, i) => {
            const isActive = i === activeIdx;
            return (
              <li
                key={p.id}
                id={`${listboxId}-opt-${p.id}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addMember(p)}
                className={`px-2 py-1.5 cursor-pointer flex items-center gap-2 ${
                  isActive ? "bg-[rgb(255_255_255/0.08)]" : ""
                }`}
              >
                <Avatar profile={p} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="text-fg truncate">{p.displayName}</div>
                  {p.handle && (
                    <div className="mono-meta-sm text-fg-faint truncate">
                      @{p.handle}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {noResults && (
            <li
              role="option"
              aria-disabled
              aria-selected={false}
              className="px-2 py-1.5 text-xs text-fg-faint"
            >
              No people match &ldquo;{query.trim()}&rdquo;.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
