"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// BottomSheet — modal sheet that slides up from the bottom on small
// viewports. Built on the same Base UI Dialog primitive as the centered
// Dialog so we inherit focus-trap, escape-to-close, scroll-lock, and
// aria-modal semantics for free.
//
// Drag-down-to-dismiss is implemented on the top stripe (4px x 36px grab
// bar inside a 32px hit zone). Pointer events only — we never animate
// layout properties; we transform-translate the popup and let the popup
// commit to a close once the drag crosses 30% of its height.

type BottomSheetProps = DialogPrimitive.Root.Props & {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  showCloseButton?: boolean;
  panelClassName?: string;
  children: React.ReactNode;
};

function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  showCloseButton = true,
  panelClassName,
  children,
  ...props
}: BottomSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props}>
      <DialogPrimitive.Portal data-slot="bottom-sheet-portal">
        <DialogPrimitive.Backdrop
          data-slot="bottom-sheet-backdrop"
          className={cn(
            "fixed inset-0 isolate z-50 bg-[color:rgb(0_0_0/0.65)] backdrop-blur-sm",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          data-slot="bottom-sheet-popup"
          aria-describedby={description ? "bottom-sheet-description" : undefined}
          className={cn(
            "fixed bottom-0 left-0 right-0 z-50 flex flex-col",
            "max-h-[92dvh] w-full",
            "rounded-t-2xl bg-[color:var(--popover)] text-fg",
            "border-t border-l border-r border-[color:var(--hairline-hi)]",
            "shadow-[0_-40px_100px_-32px_rgb(0_0_0/0.6),0_1px_0_0_rgb(255_255_255/0.08)_inset]",
            // Slide-up animation; transform + opacity only.
            "duration-250 ease-out will-change-transform",
            "data-open:animate-in data-open:slide-in-from-bottom-12 data-open:fade-in-0",
            "data-closed:animate-out data-closed:slide-out-to-bottom-12 data-closed:fade-out-0",
            "outline-none",
            "pb-[max(env(safe-area-inset-bottom),0px)]",
            panelClassName,
          )}
        >
          <BottomSheetDragHandle />
          {(title || showCloseButton) && (
            <header className="relative flex items-start justify-between gap-3 px-5 pt-1 pb-3 border-b border-hairline">
              <div className="min-w-0 flex-1">
                {title && (
                  <DialogPrimitive.Title
                    data-slot="bottom-sheet-title"
                    className="font-sans text-base font-bold tracking-tight text-fg leading-tight"
                  >
                    {title}
                  </DialogPrimitive.Title>
                )}
                {description && (
                  <DialogPrimitive.Description
                    id="bottom-sheet-description"
                    data-slot="bottom-sheet-description"
                    className="mt-1 text-xs text-fg-muted"
                  >
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {showCloseButton && (
                <DialogPrimitive.Close
                  data-slot="bottom-sheet-close"
                  className={cn(
                    "shrink-0 inline-flex items-center justify-center rounded-full",
                    "min-h-11 min-w-11",
                    "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]",
                    "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
                  )}
                >
                  <XIcon className="size-4" aria-hidden />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              )}
            </header>
          )}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {children}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Drag stripe at the top of the sheet. 32px tall hit zone with a 4x36px
// grab bar centered. Drag commits to close when translateY exceeds 30%
// of the popup's height; otherwise springs back to 0.
function BottomSheetDragHandle() {
  const popupRef = React.useRef<HTMLElement | null>(null);
  const startYRef = React.useRef<number | null>(null);
  const popupHeightRef = React.useRef<number>(0);

  function getPopup(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('[data-slot="bottom-sheet-popup"]');
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const popup = getPopup(e.currentTarget);
    if (!popup) return;
    popupRef.current = popup;
    popupHeightRef.current = popup.getBoundingClientRect().height;
    startYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    popup.style.transition = "none";
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (startYRef.current == null || !popupRef.current) return;
    const delta = e.clientY - startYRef.current;
    if (delta > 0) {
      popupRef.current.style.transform = `translateY(${delta}px)`;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (startYRef.current == null || !popupRef.current) {
      startYRef.current = null;
      return;
    }
    const delta = e.clientY - startYRef.current;
    const popup = popupRef.current;
    startYRef.current = null;

    if (delta > popupHeightRef.current * 0.3) {
      // Find the closest Dialog Close affordance; clicking the
      // SR-only close button is the simplest reliable way to fire
      // the controlled onOpenChange without re-implementing the
      // close logic here.
      const closer = popup.querySelector<HTMLButtonElement>(
        '[data-slot="bottom-sheet-close"]',
      );
      if (closer) {
        popup.style.transition = "";
        popup.style.transform = "";
        closer.click();
        return;
      }
    }
    // Snap back. CSS transition does the easing for us.
    popup.style.transition = "";
    popup.style.transform = "";
  }

  return (
    <div
      data-slot="bottom-sheet-drag"
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="flex h-8 cursor-grab items-center justify-center touch-none active:cursor-grabbing"
    >
      <span
        aria-hidden
        className="h-1 w-9 rounded-full bg-[color:var(--hairline-hi)]"
      />
    </div>
  );
}

function BottomSheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="bottom-sheet-trigger" {...props} />;
}

function BottomSheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="bottom-sheet-close-inner" {...props} />;
}

export {
  BottomSheet,
  BottomSheetTrigger,
  BottomSheetClose,
};
