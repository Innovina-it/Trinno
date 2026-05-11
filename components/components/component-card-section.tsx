"use client";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { toggleCardComponent } from "@/actions/card-components";
import { undoBus } from "@/lib/undo-bus";

export function ComponentCardSection({ cardId }: { cardId: string }) {
  const components = useBoardStore((s) => s.components);
  const cardComponents = useBoardStore((s) => s.cardComponents);
  const addCardComponent = useBoardStore((s) => s.addCardComponent);
  const removeCardComponent = useBoardStore((s) => s.removeCardComponent);
  const [pending, start] = useTransition();

  const attachedIds = useMemo(
    () =>
      new Set(
        cardComponents
          .filter((cc) => cc.cardId === cardId)
          .map((cc) => cc.componentId),
      ),
    [cardComponents, cardId],
  );

  const attached = useMemo(
    () => components.filter((c) => attachedIds.has(c.id)),
    [components, attachedIds],
  );

  function toggle(componentId: string) {
    const wasAttached = attachedIds.has(componentId);
    const componentName =
      components.find((c) => c.id === componentId)?.name ?? "Component";
    if (wasAttached) {
      removeCardComponent(cardId, componentId);
    } else {
      addCardComponent({
        cardId,
        componentId,
        boardId: "00000000-0000-0000-0000-000000000000",
      });
    }
    start(async () => {
      try {
        await toggleCardComponent({ cardId, componentId });
        undoBus.push({
          message: wasAttached
            ? `Removed ${componentName}`
            : `Added ${componentName}`,
          undo: async () => {
            if (wasAttached) {
              addCardComponent({
                cardId,
                componentId,
                boardId: "00000000-0000-0000-0000-000000000000",
              });
            } else {
              removeCardComponent(cardId, componentId);
            }
            try {
              await toggleCardComponent({ cardId, componentId });
            } catch (err) {
              if (wasAttached) {
                removeCardComponent(cardId, componentId);
              } else {
                addCardComponent({
                  cardId,
                  componentId,
                  boardId: "00000000-0000-0000-0000-000000000000",
                });
              }
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        if (wasAttached) {
          addCardComponent({
            cardId,
            componentId,
            boardId: "00000000-0000-0000-0000-000000000000",
          });
        } else {
          removeCardComponent(cardId, componentId);
        }
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="components-section">
      <div className="flex items-baseline justify-between border-b border-rule pb-1">
        <h3 className="mono-meta text-ink/70">Components</h3>
        <span className="mono-meta-sm text-ink/35">C</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {attached.length === 0 ? (
          <p className="font-serif italic text-sm text-ink/50">
            No components attached.
          </p>
        ) : (
          attached.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              data-component-id={c.id}
              data-attached="true"
              disabled={pending}
              className="mono-meta-sm flex items-center gap-1.5 border border-fg px-2 py-1 transition-opacity hover:opacity-90 disabled:opacity-60"
              title="Click to detach"
            >
              <span className="tracking-wider">{c.name}</span>
              <span aria-hidden>×</span>
            </button>
          ))
        )}

        {components.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  aria-label="Add component"
                >
                  <Plus className="size-3" />
                </Button>
              }
            />
            <DropdownMenuContent>
              {components.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  data-component-pick={c.id}
                >
                  <span className="flex-1">{c.name}</span>
                  {attachedIds.has(c.id) && <span aria-hidden>✓</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {components.length === 0 && (
        <p className="text-xs text-fg-faint italic">
          Define components in board settings.
        </p>
      )}
    </section>
  );
}
