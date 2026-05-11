"use client";

import * as React from "react";

import { useMediaQuery } from "@/lib/use-media-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";

// ResponsiveModal — single API that renders as a centered Dialog at
// `≥md:` and a BottomSheet below. Callers pass `title` / `description`
// so we can wire aria semantics on both branches without exposing two
// shapes to consumers.
//
// The breakpoint is fixed at 768px to match the rest of the responsive
// doctrine; do not parameterize. If a surface needs a different
// breakpoint, reach for `useMediaQuery` directly.

export type ResponsiveModalProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  showCloseButton?: boolean;
  /**
   * Class applied to the Dialog content wrapper at `≥md:`. Use for
   * `sm:max-w-3xl` and similar size overrides.
   */
  contentClassName?: string;
  /**
   * Class applied to the BottomSheet popup wrapper at `<md:`. Use for
   * `max-h-` overrides if 92dvh isn't right for a given surface.
   */
  sheetClassName?: string;
  children: React.ReactNode;
};

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  showCloseButton = true,
  contentClassName,
  sheetClassName,
  children,
}: ResponsiveModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={contentClassName}
          showCloseButton={showCloseButton}
        >
          {(title || description) && (
            <DialogHeader>
              {title && <DialogTitle>{title}</DialogTitle>}
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
          )}
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      showCloseButton={showCloseButton}
      panelClassName={sheetClassName}
    >
      {children}
    </BottomSheet>
  );
}
