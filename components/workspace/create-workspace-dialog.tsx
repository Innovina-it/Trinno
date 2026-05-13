"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import { createWorkspace } from "@/actions/workspaces";
import { searchProfiles } from "@/actions/profile-search";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { usePeopleCache } from "@/hooks/use-people-cache";

type Profile = { id: string; handle: string | null; displayName: string };
type Role = "admin" | "member";
type Selected = Profile & { role: Role };

// Local avatar — mirrors the AvatarDot in assignee-picker.tsx (same colour
// hashing) so the same person renders the same swatch across the app.
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
  profile: Profile;
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

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [pending, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Request-version guard — every loadSuggestions bumps this; only the
  // newest response is allowed to mutate state. Stops the slow empty-query
  // preload from clobbering a fast typed-query result.
  const reqVersion = useRef(0);
  const listboxId = useId();
  const inputId = useId();
  // Our <Input> wrapper isn't a forwardRef, so we focus by document id
  // when the user picks a member (keeps the picker keyboard-flow alive).
  const focusInput = useCallback(() => {
    (document.getElementById(inputId) as HTMLInputElement | null)?.focus();
  }, [inputId]);

  // Resolve the signed-in user once so we can hide self from results.
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

  // localStorage-backed collaborator cache. Survives page reloads, so the
  // empty-query preload renders instantly without a server round-trip.
  // Background revalidation keeps it fresh once per mount.
  const { people: cachedCollaborators, hydrated: cacheHydrated } =
    usePeopleCache(viewerId);

  const loadSuggestions = useCallback(
    async (q: string) => {
      const v = ++reqVersion.current;
      // Empty query → serve from the local cache. No network round-trip,
      // no spinner. Cache is kept warm by usePeopleCache's background
      // revalidation, so reopening the dialog after an invite shows the
      // updated list within one tick of the next mount.
      if (!q.trim()) {
        if (v !== reqVersion.current) return;
        const selectedIds = new Set(selected.map((p) => p.id));
        setSuggestions(
          cachedCollaborators.filter(
            (p) => !selectedIds.has(p.id) && p.id !== viewerId,
          ),
        );
        setActiveIdx(0);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const results = await searchProfiles(q);
        if (v !== reqVersion.current) return; // stale — drop
        const selectedIds = new Set(selected.map((p) => p.id));
        setSuggestions(
          results.filter(
            (p) => !selectedIds.has(p.id) && p.id !== viewerId,
          ),
        );
        setActiveIdx(0);
      } catch {
        if (v === reqVersion.current) setSuggestions([]);
      } finally {
        if (v === reqVersion.current) setSearching(false);
      }
    },
    [selected, viewerId, cachedCollaborators],
  );

  // Preload when dialog opens. Reset every field so reopening is clean.
  useEffect(() => {
    if (!open) return;
    setMemberQuery("");
    setSelected([]);
    setSuggestions([]);
    setActiveIdx(0);
    void loadSuggestions("");
    // loadSuggestions identity depends on `selected`/`viewerId` — we only
    // want to (re)trigger on `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the cache hydrates (or the background revalidation lands), and
  // the user hasn't typed anything yet, refresh the visible suggestions
  // from the new cache snapshot. Without this, opening the dialog before
  // cache hydration would show an empty list forever.
  useEffect(() => {
    if (!open) return;
    if (memberQuery.trim() !== "") return;
    void loadSuggestions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cachedCollaborators, cacheHydrated]);

  const handleMemberInput = useCallback(
    (value: string) => {
      setMemberQuery(value);
      // Flip the spinner on at keystroke time so the user gets immediate
      // visible feedback during the 220ms debounce window — loadSuggestions
      // will clear it when the request resolves.
      setSearching(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void loadSuggestions(value);
      }, 220);
    },
    [loadSuggestions],
  );

  function addMember(profile: Profile) {
    setSelected((prev) =>
      prev.find((p) => p.id === profile.id)
        ? prev
        : [...prev, { ...profile, role: "member" as Role }],
    );
    // Sticky multi-select — drop the picked profile from the visible
    // list but leave the listbox open so the user can keep adding.
    setSuggestions((prev) => prev.filter((p) => p.id !== profile.id));
    setActiveIdx(0);
    focusInput();
  }

  function removeMember(id: string) {
    setSelected((prev) => prev.filter((p) => p.id !== id));
  }

  function changeRole(id: string, role: Role) {
    setSelected((prev) =>
      prev.map((p) => (p.id === id ? { ...p, role } : p)),
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
      // Don't close the dialog — just clear the search.
      if (memberQuery !== "") {
        e.preventDefault();
        setMemberQuery("");
        void loadSuggestions("");
      }
    }
  }

  const showSuggestions = useMemo(
    () => suggestions.length > 0 || (memberQuery.trim() !== "" && !searching),
    [suggestions.length, memberQuery, searching],
  );
  const noResults =
    suggestions.length === 0 && memberQuery.trim() !== "" && !searching;
  const activeOptionId = suggestions[activeIdx]
    ? `${listboxId}-opt-${suggestions[activeIdx].id}`
    : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const ws = await createWorkspace({
          name,
          members: selected.map((p) => ({ id: p.id, role: p.role })),
        });
        onOpenChange(false);
        setName("");
        setSelected([]);
        setMemberQuery("");
        setSuggestions([]);
        router.push(`/w/${ws.id}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-2">
            <DialogTitle>New workspace.</DialogTitle>
            <span className="chip">FORM-NW</span>
          </div>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme team"
              required
              minLength={1}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={inputId}>
              Add members{" "}
              <span className="text-fg-faint">(optional)</span>
            </Label>

            {/* Selected member rows — avatar + name + role select + remove. */}
            {selected.length > 0 && (
              <ul
                aria-label="Selected members"
                className="space-y-1 mb-1"
                data-testid="ws-members-selected"
              >
                {selected.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-hairline bg-[color:var(--surface)] px-2 py-1.5"
                  >
                    <Avatar profile={p} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-fg truncate">
                        {p.displayName}
                      </div>
                      {p.handle && (
                        <div className="mono-meta-sm text-fg-faint truncate">
                          @{p.handle}
                        </div>
                      )}
                    </div>
                    <Select
                      value={p.role}
                      onValueChange={(v) => changeRole(p.id, v as Role)}
                      options={[
                        { value: "member", label: "Member" },
                        { value: "admin", label: "Admin" },
                      ]}
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

            {/* Combobox input — left loupe icon makes the field's purpose
                obvious; right spinner shows when a debounced search is
                actually in flight (debounce window + network). */}
            <div className="relative">
              <Search
                className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden
              />
              <Input
                id={inputId}
                value={memberQuery}
                onChange={(e) => handleMemberInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Search by name, handle, or email…"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                className="pl-9 pr-9"
              />
              {searching && (
                <Loader2
                  className="size-4 text-fg-faint absolute right-3 top-1/2 -translate-y-1/2 animate-spin pointer-events-none"
                  aria-hidden
                  data-testid="ws-members-searching"
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
                        <div className="text-fg truncate">
                          {p.displayName}
                        </div>
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
                    No people match &ldquo;{memberQuery.trim()}&rdquo;.
                  </li>
                )}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
