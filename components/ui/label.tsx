"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        // Studio-plastic: monospace, uppercase, with a 2px gradient bar to the
        // left as a visual anchor for sections / fields.
        "mono-meta text-fg-muted select-none flex items-center gap-2 relative pl-3",
        "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-3.5 before:w-[2px] before:rounded-full before:bg-gradient-to-b before:from-[color:var(--accent-cyan)] before:via-[color:var(--accent-magenta)] before:to-[color:var(--accent-violet)]",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
