"use client";
import { useEffect, useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useBoardStore } from "@/stores/board-store";
import { createCardLink, deleteCardLink } from "@/actions/card-links";
import { searchCardsForLinkAction } from "@/actions/search";
import { TypeIcon } from "./type-picker";
import {
  Link2,
  Plus,
  X,
  Search,
  Ban,
  ArrowLeftRight,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { undoBus } from "@/lib/undo-bus";

type CrossBoardCandidate = Awaited<
  ReturnType<typeof searchCardsForLinkAction>
>[number];

const KINDS = [
  { id: "blocks", label: "Blocks", Icon: Ban },
  { id: "is_blocked_by", label: "Blocked by", Icon: Ban },
  { id: "relates_to", label: "Relates to", Icon: ArrowLeftRight },
  { id: "duplicates", label: "Duplicates", Icon: Copy },
  { id: "is_duplicated_by", label: "Duplicated by", Icon: Copy },
] as const;

type KindId = (typeof KINDS)[number]["id"];

export function CardLinksSection({
  cardId,
  boardId,
}: {
  cardId: string;
  boardId: string;
}) {
  const cards = useBoardStore((s) => s.cards);
  const cardLinks = useBoardStore((s) => s.cardLinks);
  const addCardLinkLocal = useBoardStore((s) => s.addCardLink);
  const removeCardLinkLocal = useBoardStore((s) => s.removeCardLink);

  const links = useMemo(
    () => cardLinks.filter((l) => l.fromCardId === cardId),
    [cardLinks, cardId],
  );

  // Plan #16b-γ-D (#38) — for cross-board links the to-card is not in
  // this board's store. Pull display info via searchCardsForLink; we
  // cache a lookup keyed by id so the chip doesn't say "Card not in
  // this board" anymore.
  const [externalCards, setExternalCards] = useState<
    Record<string, { title: string; boardId: string; boardTitle: string; type: string }>
  >({});

  useEffect(() => {
    const missingIds = links
      .map((l) => l.toCardId)
      .filter((id) => !cards.some((c) => c.id === id))
      .filter((id) => !externalCards[id]);
    if (missingIds.length === 0) return;
    let cancelled = false;
    // We use the search endpoint with empty query to grab recents and
    // filter client-side. Cheaper than building a per-id endpoint and
    // good enough since the link picker already populates the cache.
    searchCardsForLinkAction("")
      .then((rows) => {
        if (cancelled) return;
        const next: typeof externalCards = { ...externalCards };
        for (const r of rows) {
          if (missingIds.includes(r.id)) {
            next[r.id] = {
              title: r.title,
              boardId: r.boardId,
              boardTitle: r.boardTitle,
              type: r.type,
            };
          }
        }
        setExternalCards(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [links, cards, externalCards]);

  const grouped = useMemo(() => {
    const g: Record<string, typeof links> = {};
    for (const l of links) (g[l.kind] ??= []).push(l);
    return g;
  }, [links]);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<KindId>("blocks");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  // Plan #16b-γ-D (#38) — cross-board candidates fetched from server.
  // Local same-board cards still come from the board store (fast path)
  // but the picker fans out across all readable boards via the search
  // endpoint when the dialog opens.
  const [crossBoard, setCrossBoard] = useState<CrossBoardCandidate[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchCardsForLinkAction(q);
        if (!cancelled) setCrossBoard(r);
      } catch {
        if (!cancelled) setCrossBoard([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  // Merge: local board cards (always shown, from store) + cross-board
  // results (deduped by id). Filter out the source card and archived.
  const candidates = useMemo(() => {
    const local = cards
      .filter((c) => c.id !== cardId && !c.archived)
      .filter(
        (c) => !q.trim() || c.title.toLowerCase().includes(q.toLowerCase()),
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        boardId: boardId,
        boardTitle: "", // same-board: no chip prefix
        type: (c as { type?: string }).type ?? "task",
        listId: c.listId,
      }));
    const localIds = new Set(local.map((c) => c.id));
    const remote = crossBoard
      .filter((c) => c.id !== cardId)
      .filter((c) => !localIds.has(c.id))
      .map((c) => ({
        id: c.id,
        title: c.title,
        boardId: c.boardId,
        boardTitle: c.boardTitle,
        type: c.type,
        listId: c.listId,
      }));
    return [...local, ...remote].slice(0, 30);
  }, [cards, cardId, q, crossBoard, boardId]);

  function add(targetId: string) {
    start(async () => {
      try {
        const link = await createCardLink({
          fromCardId: cardId,
          toCardId: targetId,
          kind,
        });
        addCardLinkLocal(link);
        // The mirror row will arrive via realtime
        setOpen(false);
        setQ("");
        undoBus.push({
          message: "Card link added",
          undo: async () => {
            removeCardLinkLocal(link.id);
            try {
              await deleteCardLink({ id: link.id });
            } catch (err) {
              addCardLinkLocal(link);
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function remove(id: string) {
    const link = cardLinks.find((l) => l.id === id);
    if (!link) return;
    removeCardLinkLocal(id);
    start(async () => {
      try {
        await deleteCardLink({ id });
        undoBus.push({
          message: "Card link removed",
          undo: async () => {
            try {
              const restored = await createCardLink({
                fromCardId: link.fromCardId,
                toCardId: link.toCardId,
                kind: link.kind,
              });
              addCardLinkLocal(restored);
            } catch (err) {
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        addCardLinkLocal(link);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-3" data-testid="card-links-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Linked issues</h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          <Plus className="size-3.5 mr-0.5" /> LINK
        </Button>
      </div>

      {Object.keys(grouped).length === 0 && (
        <p className="text-sm text-fg-faint italic">No linked issues.</p>
      )}

      {KINDS.map((k) => {
        const list = grouped[k.id];
        if (!list?.length) return null;
        return (
          <div key={k.id} className="space-y-1">
            <div className="mono-meta-sm text-fg-faint inline-flex items-center gap-1.5">
              <k.Icon className="size-3" /> {k.label.toUpperCase()}
            </div>
            <ul className="space-y-1">
              {list.map((l) => {
                const target = cards.find((c) => c.id === l.toCardId);
                const external = !target ? externalCards[l.toCardId] : null;
                const displayTitle = target?.title ?? external?.title;
                const displayType =
                  (target as { type?: string } | undefined)?.type ??
                  external?.type ??
                  "task";
                const displayBoardId = target ? boardId : external?.boardId;
                const externalBoardTitle = external?.boardTitle;
                return (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
                    data-testid="card-link-item"
                    data-cross-board={external ? "true" : undefined}
                  >
                    {displayTitle && displayBoardId ? (
                      <>
                        <TypeIcon type={displayType} className="size-3.5" />
                        {externalBoardTitle && (
                          <span
                            className="chip mono-meta-sm shrink-0"
                            title={`On board: ${externalBoardTitle}`}
                          >
                            <ExternalLink className="size-2.5 mr-1 inline" />
                            {externalBoardTitle}
                          </span>
                        )}
                        <Link
                          href={`/b/${displayBoardId}/c/${l.toCardId}`}
                          className="flex-1 truncate hover:underline"
                        >
                          {displayTitle}
                        </Link>
                      </>
                    ) : (
                      <span className="flex-1 text-fg-muted italic">
                        Loading…
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => remove(l.id)}
                      disabled={pending}
                      aria-label="Remove link"
                    >
                      <X className="size-3" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link an issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]">
                <Link2 className="size-3.5" />
                <span>
                  {(KINDS.find((k) => k.id === kind) ?? KINDS[0]).label.toUpperCase()}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={kind}
                  onValueChange={(v) => setKind(v as KindId)}
                >
                  {KINDS.map((k) => (
                    <DropdownMenuRadioItem
                      key={k.id}
                      value={k.id}
                      className="gap-2"
                    >
                      <k.Icon className="size-3.5" /> {k.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative">
              <Search className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                autoFocus
                placeholder="Search cards on this board…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <ul
              className="max-h-72 overflow-y-auto divide-y divide-hairline"
              data-testid="card-link-candidates"
            >
              {candidates.map((c) => {
                const isExternal = c.boardId !== boardId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => add(c.id)}
                      disabled={pending}
                      data-testid={`card-link-candidate-${c.id}`}
                      data-cross-board={isExternal ? "true" : undefined}
                      className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                    >
                      <TypeIcon type={c.type} />
                      {isExternal && c.boardTitle && (
                        <span
                          className="chip mono-meta-sm shrink-0"
                          title={`On board: ${c.boardTitle}`}
                        >
                          <ExternalLink className="size-2.5 mr-1 inline" />
                          {c.boardTitle}
                        </span>
                      )}
                      <span className="text-sm truncate">{c.title}</span>
                    </button>
                  </li>
                );
              })}
              {candidates.length === 0 && (
                <li className="px-2 py-4 text-sm text-fg-muted text-center">
                  No matches.
                </li>
              )}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
