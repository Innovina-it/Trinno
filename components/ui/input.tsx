import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Editorial-industrial: hairline ink border, square corners,
        // border thickens to 2px ink on focus (no glow ring).
        "h-9 w-full min-w-0 rounded-none border border-ink/70 bg-paper-shadow px-2.5 py-1 text-sm transition-[border-width,border-color,background-color] outline-none",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "placeholder:text-foreground/40 placeholder:italic placeholder:font-serif",
        "focus-visible:border-2 focus-visible:border-ink focus-visible:bg-paper",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-signal aria-invalid:text-signal",
        className
      )}
      {...props}
    />
  )
}

export { Input }
