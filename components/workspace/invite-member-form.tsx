"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";
import { inviteMember, inviteMemberByUserId } from "@/actions/workspace-members";
import { lookupProfileByEmail } from "@/actions/profile-lookup";
import { searchProfiles } from "@/actions/profile-search";
import { Avatar, type PickerProfile } from "@/components/people/people-picker";
import { usePeopleCache } from "@/hooks/use-people-cache";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { toast } from "sonner";

// Lightweight client guard to decide email-path vs alias-path. The server
// still applies the strict `Email` schema, so this only needs to route.
const IS_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Handles are stored without the leading "@", so drop it before searching —
// otherwise "@luca" never matches the "luca" handle.
const stripAt = (s: string) => s.trim().replace(/^@/, "");

type Preview =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; displayName: string; handle: string | null }
  | { state: "exists" } // user exists but caller can't read their profile
  | { state: "missing" } // email path: no account → brand-new invite
  | { state: "no-match" } // alias path: nobody found
  | { state: "ambiguous" }; // alias path: several match, none exact

export function InviteMemberForm({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const isGuest = useIsGuest();

  // Suggestion dropdown — mirrors the create-workspace PeoplePicker: clicking
  // the field surfaces the people you already share workspaces with, typing
  // searches all profiles. Picking one invites them by id (auth.users.email
  // is RLS-hidden, so the server resolves the address). Typing a raw email and
  // pressing Invite still works for brand-new people with no account.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // A person chosen from the dropdown — NOT yet invited. The field shows their
  // name; the actual invite only fires when the user confirms with Invite.
  const [selected, setSelected] = useState<PickerProfile | null>(null);
  const [suggestions, setSuggestions] = useState<PickerProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [justInvited, setJustInvited] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reqVersion = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Collaborator list (localStorage-cached) is used only for instant
  // client-side matches as you type — no full list on empty focus.
  const { people: cachedCollaborators } = usePeopleCache(viewerId);

  // Same set the new-workspace picker shows — everyone you collaborate with.
  // We deliberately do NOT hide existing members (parity with new workspace);
  // re-inviting one is a harmless no-op / "already invited" notice. Only self
  // and people invited in this session are dropped.
  const excludeSet = useMemo(() => {
    const s = new Set<string>();
    if (viewerId) s.add(viewerId);
    for (const id of justInvited) s.add(id);
    return s;
  }, [viewerId, justInvited]);

  const loadSuggestions = useCallback(
    async (q: string) => {
      const v = ++reqVersion.current;
      const keep = (p: PickerProfile) => !excludeSet.has(p.id);
      // Nothing to suggest until the user types — no full list on focus.
      const needle = stripAt(q);
      if (!needle) {
        if (v !== reqVersion.current) return;
        setSuggestions([]);
        setActiveIdx(0);
        setSearching(false);
        return;
      }
      setSearching(true);
      // Instant matches from the cached collaborators (handle prefix or name),
      // so "L" surfaces Luca immediately while the server query resolves.
      const cmp = needle.toLowerCase();
      const instant = cachedCollaborators
        .filter(
          (p) =>
            (p.handle?.toLowerCase().startsWith(cmp) ?? false) ||
            p.displayName.toLowerCase().includes(cmp),
        )
        .filter(keep);
      if (v === reqVersion.current && instant.length > 0) {
        setSuggestions(instant);
        setActiveIdx(0);
      }
      try {
        const results = await searchProfiles(needle);
        if (v !== reqVersion.current) return;
        setSuggestions(results.filter(keep));
        setActiveIdx(0);
      } catch {
        if (v === reqVersion.current) setSuggestions(instant);
      } finally {
        if (v === reqVersion.current) setSearching(false);
      }
    },
    [cachedCollaborators, excludeSet],
  );

  // Debounced existence preview, so the user can confirm "this person exists"
  // BEFORE inviting — for both a typed email AND a typed alias/handle/name.
  // Email → account lookup; alias → resolve to the same single profile the
  // Invite button would pick (exact handle, then exact name, then a lone hit).
  useEffect(() => {
    if (selected) {
      setPreview({ state: "idle" });
      return;
    }
    const trimmed = email.trim();
    if (trimmed.length < 2) {
      setPreview({ state: "idle" });
      return;
    }
    setPreview({ state: "checking" });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (IS_EMAIL.test(trimmed)) {
          const r = await lookupProfileByEmail(trimmed);
          if (cancelled) return;
          if (r.kind === "found") {
            setPreview({
              state: "found",
              displayName: r.displayName,
              handle: r.handle,
            });
          } else if (r.kind === "exists") {
            setPreview({ state: "exists" });
          } else {
            setPreview({ state: "missing" });
          }
        } else {
          const needle = stripAt(trimmed);
          const results = await searchProfiles(needle);
          if (cancelled) return;
          const cmp = needle.toLowerCase();
          const match =
            results.find((r) => r.handle?.toLowerCase() === cmp) ??
            results.find((r) => r.displayName.toLowerCase() === cmp) ??
            (results.length === 1 ? results[0] : null);
          if (match) {
            setPreview({
              state: "found",
              displayName: match.displayName,
              handle: match.handle,
            });
          } else if (results.length > 0) {
            setPreview({ state: "ambiguous" });
          } else {
            setPreview({ state: "no-match" });
          }
        }
      } catch {
        if (!cancelled) setPreview({ state: "idle" });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email, selected]);

  function handleInput(value: string) {
    setEmail(value);
    // Typing over a chosen name reverts to the raw-email path.
    setSelected(null);
    setSearching(true);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => {
      void loadSuggestions(value);
    }, 220);
  }

  // Clicking a suggestion only SELECTS it — fills the field and waits for the
  // user to confirm with the Invite button (or Enter). No request fires here.
  function pick(profile: PickerProfile) {
    setSelected(profile);
    setEmail(profile.displayName);
    setPreview({ state: "idle" });
    setOpen(false);
    setActiveIdx(0);
  }

  // Resolve a typed alias/handle/name (not an email) to a single profile so
  // Invite works without picking from the dropdown. Prefers an exact handle,
  // then exact display name, then a lone match; bails if it's ambiguous.
  async function resolveAlias(value: string): Promise<PickerProfile | null> {
    const needle = stripAt(value);
    if (!needle) return null;
    const cmp = needle.toLowerCase();
    const results = await searchProfiles(needle);
    return (
      results.find((r) => r.handle?.toLowerCase() === cmp) ??
      results.find((r) => r.displayName.toLowerCase() === cmp) ??
      (results.length === 1 ? results[0] : null)
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    start(async () => {
      try {
        let res: Awaited<ReturnType<typeof inviteMember>>;
        let invitedId: string | null = null;
        if (selected) {
          // Picked from the dropdown → invite by id (no client-side email).
          res = await inviteMemberByUserId({ workspaceId, userId: selected.id, role });
          invitedId = selected.id;
        } else if (IS_EMAIL.test(value)) {
          // A real address → raw-email path (handles brand-new people too).
          res = await inviteMember({ workspaceId, email: value, role });
        } else {
          // Typed an alias/handle/name → resolve it to one profile.
          const match = await resolveAlias(value);
          if (!match) {
            toast.error(
              "No one matches that name. Pick someone from the list or type a full email address.",
            );
            return;
          }
          res = await inviteMemberByUserId({ workspaceId, userId: match.id, role });
          invitedId = match.id;
        }
        // Expected failures (rate limit, already invited, …) come back as data
        // so the real message survives Next's production error redaction.
        if (res.kind === "error") {
          toast.error(res.message);
          return;
        }
        if (invitedId) {
          const id = invitedId;
          setJustInvited((prev) => new Set(prev).add(id));
        }
        setSelected(null);
        setEmail("");
        setPreview({ state: "idle" });
        setOpen(false);
        toast.success(res.kind === "invited" ? "Invite sent" : "Added to workspace");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      const target = suggestions[activeIdx];
      if (target) {
        // A highlighted suggestion takes Enter; the raw-email submit only runs
        // when the dropdown isn't offering a pick.
        e.preventDefault();
        pick(target);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (isGuest) return null;

  const showSuggestions = open && suggestions.length > 0;

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <Label htmlFor="invite-email">Email</Label>
      <div className="relative">
        <div className="flex items-center gap-2">
          <Input
            id="invite-email"
            // Plain text, not email: the field doubles as a people search and
            // can hold a chosen person's display name, which isn't an address.
            type="text"
            value={email}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => {
              // No list on focus — suggestions only appear once you type.
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setOpen(true);
            }}
            onBlur={() => {
              // Delay so an option's mousedown/click registers before close.
              blurTimer.current = setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={handleKey}
            required
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="invite-suggestions"
            aria-describedby="invite-preview"
            className="flex-1"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline">
                  Role: {role}
                </Button>
              }
            />
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={role}
                onValueChange={(v) => setRole(v as "admin" | "member" | "guest")}
              >
                <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="guest">Guest (read-only)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="submit"
            disabled={pending || !email}
          >
            Invite
          </Button>
        </div>

        {showSuggestions && (
          <ul
            id="invite-suggestions"
            role="listbox"
            aria-label="People suggestions"
            className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-hairline bg-[color:var(--popover)] py-1 text-sm max-h-56 overflow-y-auto shadow-lg"
          >
            {suggestions.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.id}
                  id={`invite-opt-${p.id}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
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
          </ul>
        )}
      </div>
      <div
        id="invite-preview"
        className="mono-meta-sm text-fg-faint min-h-4 flex items-center gap-1.5"
        aria-live="polite"
      >
        {selected ? (
          <>
            <span className="text-fg">SELECTED — {selected.displayName}</span>
            {selected.handle && (
              <span className="text-fg-muted"> · @{selected.handle}</span>
            )}
            <span className="text-fg-muted"> · PRESS INVITE TO CONFIRM</span>
          </>
        ) : (
          <>
            {searching && open && (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            )}
            {preview.state === "checking" && "CHECKING…"}
            {preview.state === "found" && (
              <>
                <span className="text-fg">{preview.displayName}</span>
                {preview.handle && (
                  <span className="text-fg-muted"> · @{preview.handle}</span>
                )}
              </>
            )}
            {preview.state === "exists" && "USER EXISTS"}
            {preview.state === "missing" && (
              <span className="text-fg-muted">
                NEW PERSON — WE&apos;LL EMAIL AN INVITE TO SET A PASSWORD
              </span>
            )}
            {preview.state === "no-match" && (
              <span className="text-fg-muted">
                NO PERSON FOUND — TYPE A FULL EMAIL TO INVITE SOMEONE NEW
              </span>
            )}
            {preview.state === "ambiguous" && (
              <span className="text-fg-muted">
                MULTIPLE MATCHES — PICK ONE FROM THE LIST
              </span>
            )}
          </>
        )}
      </div>
    </form>
  );
}
