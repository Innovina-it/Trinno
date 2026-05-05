"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { reorderGadgets } from "@/actions/gadgets";
import { toast } from "sonner";

type Item = {
  id: string;
  sizeClass: string;
  // Pre-rendered gadget body (server-side) for this id.
  child: React.ReactNode;
};

const SIZE_TO_CLASS: Record<string, string> = {
  "1x1": "col-span-1 row-span-1",
  "2x1": "col-span-1 sm:col-span-2 row-span-1",
  "2x2": "col-span-1 sm:col-span-2 row-span-2",
  "3x1": "col-span-1 sm:col-span-2 lg:col-span-3 row-span-1",
  "3x2": "col-span-1 sm:col-span-2 lg:col-span-3 row-span-2",
};

function SortableTile({
  item,
  draggable,
}: {
  item: Item;
  draggable: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !draggable });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.16,1,0.3,1)",
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-gadget-id={item.id}
      data-testid="gadget"
      className={`relative group/gadget ${item.sizeClass}`}
    >
      {draggable && (
        <button
          type="button"
          aria-label="Reorder gadget"
          data-testid="gadget-drag-handle"
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-10 size-5 inline-flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-[color:var(--surface-strong)] cursor-grab active:cursor-grabbing opacity-0 group-hover/gadget:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {item.child}
    </div>
  );
}

export function SortableGadgetGrid({
  items,
  dashboardId,
  draggable,
}: {
  items: Item[];
  dashboardId: string;
  draggable: boolean;
}) {
  // Local order, refreshed when the server-rendered list changes.
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.id));
  useEffect(() => {
    setOrder(items.map((i) => i.id));
  }, [items]);
  const [, startT] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(active.id as string);
    const newIdx = order.indexOf(over.id as string);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    startT(async () => {
      try {
        await reorderGadgets({ dashboardId, orderedIds: next });
      } catch (err) {
        // Rollback on failure.
        setOrder(order);
        toast.error((err as Error).message);
      }
    });
  }

  // Look up by id so we render in the latest order even though `items`
  // was the SSR snapshot.
  const byId = new Map(items.map((i) => [i.id, i]));
  void SIZE_TO_CLASS;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-[minmax(180px,auto)]"
          data-testid="dashboard-grid"
        >
          {order.map((id) => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <SortableTile
                key={id}
                item={item}
                draggable={draggable}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
