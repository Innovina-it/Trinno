import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// One line of the analysis "manifest": a fixed mono label rail on the left, the
// control on the right. Shared grammar for every config row (source, sections,
// length, focus, contributors) so the panel reads as a single spec sheet, not a
// stack of differently-styled widgets. No card, no fill: structure does the work.
export function ConfigRow({
  label,
  htmlFor,
  align = "center",
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  align?: "center" | "start";
  children: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      className={cn(
        "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-5 py-3.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      <Label
        {...(htmlFor ? { htmlFor } : {})}
        className={cn(
          "mono-meta-sm tracking-[0.14em] text-fg-faint",
          align === "start" && "pt-1.5",
        )}
      >
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
