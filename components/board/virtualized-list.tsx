"use client";

import { createElement, useMemo, useRef, type ReactNode } from "react";
import { useDndContext, type Active } from "@dnd-kit/core";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual";

type IdentifiableItem = {
  id?: string | number;
};

function itemId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const id = (item as IdentifiableItem).id;
  return id == null ? null : String(id);
}

function activeCardId(active: Active | null): string | null {
  if (!active) return null;
  const data = active.data.current as { cardId?: unknown } | undefined;
  if (typeof data?.cardId === "string") return data.cardId;

  const rawId = String(active.id);
  return rawId.startsWith("card:") ? rawId.slice("card:".length) : rawId;
}

export function VirtualizedList<T>({
  items,
  estimatedSize,
  overscan,
  render,
}: {
  items: T[];
  estimatedSize: number;
  overscan: number;
  render: (item: T, index: number, virtualItem: VirtualItem) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const { active } = useDndContext();
  const draggedCardId = activeCardId(active);
  const draggedIndex = useMemo(() => {
    if (!draggedCardId) return -1;
    return items.findIndex((item) => itemId(item) === draggedCardId);
  }, [draggedCardId, items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedSize,
    overscan,
    initialRect: {
      width: 320,
      height: estimatedSize * 10,
    },
    getItemKey: (index) => itemId(items[index]) ?? index,
    rangeExtractor: (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (draggedIndex < 0 || indexes.includes(draggedIndex)) return indexes;
      return [...indexes, draggedIndex].sort((a, b) => a - b);
    },
  });

  return createElement(
    "div",
    {
      ref: parentRef,
      "data-testid": "virtualized-list",
      className: "min-h-0 w-full overflow-y-auto",
      style: { maxHeight: "inherit", contain: "strict" },
    },
    createElement(
      "div",
      {
        "data-testid": "virtualized-list-spacer",
        className: "relative w-full",
        style: { height: virtualizer.getTotalSize() },
      },
      virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        if (item === undefined) return null;
        const preservedDrag = virtualItem.index === draggedIndex;
        return createElement(
          "div",
          {
            key: virtualItem.key,
            ref: virtualizer.measureElement,
            "data-index": virtualItem.index,
            "data-preserved-drag": preservedDrag ? "true" : undefined,
            className: "absolute left-0 top-0 w-full pb-2.5",
            style: {
              transform: `translateY(${virtualItem.start}px)`,
            },
          },
          render(item, virtualItem.index, virtualItem),
        );
      }),
    ),
  );
}
