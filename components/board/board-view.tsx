"use client";
import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useBoardStore } from "@/stores/board-store";
import type { BoardRow } from "@/lib/queries/board-snapshot";
import { positionBetween } from "@/lib/ordering";
import { moveCard as moveCardAction } from "@/actions/cards";
import { moveList as moveListAction } from "@/actions/lists";
import { Button } from "@/components/ui/button";
import { ListColumn } from "./list-column";
import { AddListForm } from "./add-list-form";
import { useBoardRealtime } from "@/hooks/use-board-realtime";
import { useBoardPresence, type Viewer } from "@/hooks/use-board-presence";
import { PresenceAvatars } from "./presence-avatars";
import { boardCode } from "@/lib/format";

function decodeId(
  sortableId: string,
): { type: "list" | "card"; id: string } | null {
  const idx = sortableId.indexOf(":");
  if (idx < 0) return null;
  const prefix = sortableId.slice(0, idx);
  const id = sortableId.slice(idx + 1);
  if (prefix === "list") return { type: "list", id };
  if (prefix === "card") return { type: "card", id };
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(v, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function BoardView({
  board,
  currentUser,
  children,
}: {
  board: BoardRow;
  currentUser: Viewer;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const lists = useBoardStore((s) => s.lists);
  const cards = useBoardStore((s) => s.cards);
  const moveListLocal = useBoardStore((s) => s.moveList);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  const [, start] = useTransition();

  useBoardRealtime(board.id);
  const viewers = useBoardPresence(board.id, currentUser);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const listSortableIds = useMemo(
    () => lists.map((l) => `list:${l.id}`),
    [lists],
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeKey = decodeId(String(active.id));
    if (!activeKey) return;

    if (activeKey.type === "list") {
      const overKey = decodeId(String(over.id));
      if (!overKey || overKey.type !== "list") return;

      const fromIdx = lists.findIndex((l) => l.id === activeKey.id);
      const toIdx = lists.findIndex((l) => l.id === overKey.id);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = arrayMove(lists, fromIdx, toIdx);
      const before = toIdx > 0 ? reordered[toIdx - 1].position : null;
      const after =
        toIdx < reordered.length - 1 ? reordered[toIdx + 1].position : null;
      const newPos = positionBetween(before, after);

      moveListLocal(activeKey.id, newPos);
      start(async () => {
        try {
          await moveListAction({ id: activeKey.id, position: newPos });
        } catch (err) {
          toast.error("Failed to move list: " + (err as Error).message);
          router.refresh();
        }
      });
      return;
    }

    if (activeKey.type === "card") {
      const overKey = decodeId(String(over.id));
      const overData = over.data.current as
        | { type?: string; listId?: string }
        | undefined;

      const sourceCard = cards.find((c) => c.id === activeKey.id);
      if (!sourceCard) return;

      let toListId: string | null = null;
      let prevPos: string | null = null;
      let nextPos: string | null = null;

      if (overKey?.type === "card") {
        const targetCard = cards.find((c) => c.id === overKey.id);
        if (!targetCard) return;
        toListId = targetCard.listId;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        let dropIndex = targetListCards.findIndex((c) => c.id === overKey.id);
        if (dropIndex < 0) dropIndex = targetListCards.length;
        prevPos =
          dropIndex > 0 ? targetListCards[dropIndex - 1].position : null;
        nextPos =
          dropIndex < targetListCards.length
            ? targetListCards[dropIndex].position
            : null;
      } else if (overData?.type === "list-drop" || overData?.type === "list") {
        toListId = overData.listId ?? null;
        if (!toListId) return;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        prevPos =
          targetListCards.length > 0
            ? targetListCards[targetListCards.length - 1].position
            : null;
        nextPos = null;
      } else {
        return;
      }

      if (!toListId) return;
      const newPos = positionBetween(prevPos, nextPos);
      const targetListId = toListId;
      moveCardLocal(activeKey.id, targetListId, newPos);
      start(async () => {
        try {
          await moveCardAction({
            id: activeKey.id,
            listId: targetListId,
            position: newPos,
          });
        } catch (err) {
          toast.error("Failed to move card: " + (err as Error).message);
          router.refresh();
        }
      });
    }
  }

  const baseColor =
    board.backgroundKind === "color" ? board.backgroundValue : "#8b5cf6";
  const [r, g, b] = hexToRgb(baseColor);
  // Layered: deep mesh + colored wash from board.backgroundValue at ~18% opacity
  const bg = `radial-gradient(60rem 40rem at 8% 12%,  rgb(139 92 246 / 0.45), transparent 60%),
              radial-gradient(50rem 36rem at 92% 88%, rgb(255 43 214 / 0.30), transparent 60%),
              radial-gradient(40rem 30rem at 50% 50%, rgb(0 229 255 / 0.16), transparent 60%),
              radial-gradient(50rem 35rem at 50% 0%, rgb(${r} ${g} ${b} / 0.18), transparent 60%),
              var(--bg-deep)`;

  return (
    <div
      className="-m-6 min-h-[calc(100vh-3rem)] flex flex-col relative"
      style={{ background: bg }}
    >
      {/* Soft noise overlay layered over the colored mesh */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>\")",
          backgroundSize: "200px 200px",
        }}
      />

      {/* Board masthead — glass strip with gradient title accent */}
      <div className="relative border-b border-hairline px-6 py-5 backdrop-blur-xl bg-[color:rgb(15_8_42/0.40)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2.5 min-w-0">
            <div className="mono-meta-sm flex items-center gap-2 text-fg-faint">
              <span className="chip">BOARD</span>
              <span className="text-fg/60">#{boardCode(board.id)}</span>
              <span
                aria-hidden
                className="block h-2 w-8 rounded-full"
                style={{
                  backgroundColor: baseColor,
                  boxShadow: `0 0 12px ${baseColor}`,
                }}
              />
            </div>
            <h1 className="serif-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.95]">
              <span className="gradient-text">{board.title}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <PresenceAvatars viewers={viewers} />
            <Button
              render={<Link href={`/b/${board.id}/settings`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Board settings
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex flex-1 items-start gap-4 p-4">
        <div className="flex-1 min-w-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={onDragEnd}
          >
            <div className="flex items-start gap-4 overflow-x-auto px-2 pb-4 [&>*]:animate-in [&>*]:fade-in [&>*]:slide-in-from-bottom-3 [&>*]:duration-400">
              <SortableContext
                items={listSortableIds}
                strategy={horizontalListSortingStrategy}
              >
                {lists.map((list, idx) => (
                  <ListColumn
                    key={list.id}
                    list={list}
                    boardId={board.id}
                    ordinal={idx + 1}
                  />
                ))}
              </SortableContext>
              <AddListForm boardId={board.id} />
            </div>
          </DndContext>
        </div>
        {children}
      </div>
    </div>
  );
}
