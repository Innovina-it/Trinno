import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Studio-plastic: glass with hairline, pill / rounded corners,
        // cyan focus glow ring (no harsh 2px border switch).
        "h-10 w-full min-w-0 rounded-xl px-3.5 py-1 text-sm text-fg",
        "bg-[color:var(--surface)] border border-[color:var(--hairline)]",
        "transition-[background-color,border-color,box-shadow,color] duration-200 ease-out outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "placeholder:text-fg-faint placeholder:italic placeholder:font-serif",
        "hover:border-[color:var(--hairline-hi)]",
        "focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)] focus-visible:shadow-[0_0_0_3px_rgb(0_229_255/0.20),inset_0_1px_0_0_rgb(255_255_255/0.08)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[color:var(--accent-magenta)]/60 aria-invalid:text-[color:var(--accent-magenta)] aria-invalid:focus-visible:shadow-[0_0_0_3px_rgb(255_43_214/0.25)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
