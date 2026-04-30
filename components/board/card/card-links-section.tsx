"use client";
import { useState, useTransition, useMemo } from "react";
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
import { TypeIcon } from "./type-picker";
import {
  Link2,
  Plus,
  X,
  Search,
  Ban,
  ArrowLeftRight,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

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

  const grouped = useMemo(() => {
    const g: Record<string, typeof links> = {};
    for (const l of links) (g[l.kind] ??= []).push(l);
    return g;
  }, [links]);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<KindId>("blocks");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const candidates = useMemo(() => {
    return cards
      .filter((c) => c.id !== cardId && !c.archived)
      .filter(
        (c) => !q.trim() || c.title.toLowerCase().includes(q.toLowerCase()),
      )
      .slice(0, 30);
  }, [cards, cardId, q]);

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
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      try {
        await deleteCardLink({ id });
        removeCardLinkLocal(id);
      } catch (err) {
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
                return (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
                  >
                    {target ? (
                      <>
                        <TypeIcon
                          type={(target as { type?: string }).type ?? "task"}
                          className="size-3.5"
                        />
                        <Link
                          href={`/b/${boardId}/c/${target.id}`}
                          className="flex-1 truncate hover:underline"
                        >
                          {target.title}
                        </Link>
                      </>
                    ) : (
                      <span className="flex-1 text-fg-muted italic">
                        Card not in this board
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
            <ul className="max-h-72 overflow-y-auto divide-y divide-hairline">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => add(c.id)}
                    disabled={pending}
                    className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                  >
                    <TypeIcon type={(c as { type?: string }).type ?? "task"} />
                    <span className="text-sm truncate">{c.title}</span>
                  </button>
                </li>
              ))}
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
