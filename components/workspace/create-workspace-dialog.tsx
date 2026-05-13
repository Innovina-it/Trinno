"use client";
import { useEffect, useState, useTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { X } from "lucide-react";
import { createWorkspace } from "@/actions/workspaces";
import { searchProfiles } from "@/actions/profile-search";

type Profile = { id: string; handle: string | null; displayName: string };

export function CreateWorkspaceDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [pending, start] = useTransition();
  const [searching, setSearching] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared loader — empty query → top 12 profiles. Used by initial open
  // and by the input handler (debounced).
  const loadSuggestions = useCallback(
    async (q: string) => {
      setSearching(true);
      try {
        const results = await searchProfiles(q);
        const selectedIds = new Set(selected.map((p) => p.id));
        setSuggestions(results.filter((p) => !selectedIds.has(p.id)));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    },
    [selected],
  );

  // Preload the default suggestion list when the dialog opens. Reset
  // input + selections so the next open is clean.
  useEffect(() => {
    if (!open) return;
    setMemberQuery("");
    void loadSuggestions("");
    // intentionally exclude loadSuggestions from deps — its identity
    // depends on `selected`, which we don't want to re-trigger on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleMemberInput = useCallback((value: string) => {
    setMemberQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadSuggestions(value);
    }, 220);
  }, [loadSuggestions]);

  function addMember(profile: Profile) {
    setSelected((prev) => {
      if (prev.find((p) => p.id === profile.id)) return prev;
      return [...prev, profile];
    });
    setMemberQuery("");
    setSuggestions([]);
  }

  function removeMember(id: string) {
    setSelected((prev) => prev.filter((p) => p.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const ws = await createWorkspace({
          name,
          memberIds: selected.map((p) => p.id),
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

          {/* Member picker */}
          <div className="space-y-2">
            <Label htmlFor="ws-members">Add members <span className="text-fg-faint">(optional)</span></Label>

            {/* Chips for selected members */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {selected.map((p) => (
                  <span
                    key={p.id}
                    className="chip inline-flex items-center gap-1 text-xs"
                  >
                    {p.displayName || p.handle || p.id.slice(0, 8)}
                    <button
                      type="button"
                      aria-label={`Remove ${p.displayName}`}
                      onClick={() => removeMember(p.id)}
                      className="ml-0.5 text-fg-muted hover:text-fg"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Input
                id="ws-members"
                value={memberQuery}
                onChange={(e) => handleMemberInput(e.target.value)}
                placeholder="Search by name or handle…"
                autoComplete="off"
              />
              {(suggestions.length > 0 || searching) && (
                <ul className="absolute z-50 mt-1 w-full rounded-lg border border-hairline bg-[color:var(--surface)] shadow-lg py-1 text-sm">
                  {searching && (
                    <li className="px-3 py-2 text-fg-faint mono-meta-sm">Searching…</li>
                  )}
                  {!searching && suggestions.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-[rgb(255_255_255/0.06)] flex items-center gap-2"
                        onClick={() => addMember(p)}
                      >
                        <span className="font-medium text-fg">{p.displayName}</span>
                        {p.handle && (
                          <span className="text-fg-faint mono-meta-sm">@{p.handle}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
