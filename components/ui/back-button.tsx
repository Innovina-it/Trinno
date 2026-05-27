"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { consumeRoadmapCardOrigin } from "@/lib/roadmap/back-nav";

/**
 * Small reusable "go back" control. Presentational by default — drop it
 * top-right of a modal / page and it returns the user to where they came
 * from.
 *
 * Behavior:
 *  - `onClick` provided → caller owns the action (e.g. a dialog passes its
 *    dirty-aware dismiss handler so unsaved-edit guards still fire).
 *  - no `onClick` → smart default: honor the roadmap-origin breadcrumb when
 *    present ([[project_card_route_intercept]]), else `fallbackHref`, else
 *    plain `router.back()`. Reuses lib/roadmap/back-nav so there's no second
 *    copy of the navigation rule.
 */
export function BackButton({
  onClick,
  label = "Back",
  fallbackHref,
  className,
  ...rest
}: {
  /** Override the default navigation (e.g. dialog dismiss). */
  onClick?: () => void;
  /** Visible + accessible label. Defaults to "Back". */
  label?: string;
  /** Used by the smart default when there's no breadcrumb to honor. */
  fallbackHref?: string;
} & Omit<
  React.ComponentProps<typeof Button>,
  "onClick" | "children" | "aria-label"
>) {
  const router = useRouter();

  function defaultBack() {
    const origin = consumeRoadmapCardOrigin();
    if (origin) {
      router.replace(origin, { scroll: false });
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref);
      return;
    }
    router.back();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick ?? defaultBack}
      aria-label={label}
      className={className}
      {...rest}
    >
      <ArrowLeft aria-hidden />
      {label}
    </Button>
  );
}
