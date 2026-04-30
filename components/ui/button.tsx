import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Studio-plastic: pill / rounded shapes, glass surfaces, gradient primary,
  // colored focus glow ring (no harsh outline).
  [
    "group/button inline-flex shrink-0 items-center justify-center text-sm font-medium whitespace-nowrap select-none",
    "outline-none",
    "transition-[background-color,background-position,box-shadow,color,transform,opacity,border-color] duration-200 ease-out",
    "focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-[color:var(--accent-cyan)]/60",
    "active:not-aria-[haspopup]:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:ring-2 aria-invalid:ring-[color:var(--accent-magenta)]/50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary: saturated magenta→violet gradient pill with shimmer + glow
        default:
          "shimmer-cta rounded-full text-white",
        // Outline: glass with hairline, brightens on hover
        outline:
          "glass rounded-full text-fg hover:bg-[color:var(--surface-strong)] hover:border-[color:var(--hairline-hi)] aria-expanded:bg-[color:var(--surface-strong)]",
        // Secondary: opaque glass, subtle accent on hover
        secondary:
          "rounded-full bg-[color:var(--surface-strong)] text-fg border border-[color:var(--hairline)] hover:bg-[color:var(--surface-hi)] hover:border-[color:var(--hairline-hi)] aria-expanded:bg-[color:var(--surface-hi)]",
        // Ghost: minimal, gradient-text on hover
        ghost:
          "rounded-full text-fg-muted hover:text-fg hover:bg-[color:var(--surface)] aria-expanded:bg-[color:var(--surface)] aria-expanded:text-fg",
        // Destructive: magenta-tinted glass
        destructive:
          "rounded-full bg-[color:rgb(255_43_214/0.10)] text-[color:var(--accent-magenta)] border border-[color:rgb(255_43_214/0.35)] hover:bg-[color:rgb(255_43_214/0.18)] hover:border-[color:rgb(255_43_214/0.55)]",
        // Link: underlined, gradient on hover
        link:
          "text-fg underline underline-offset-4 decoration-[color:var(--hairline-hi)] hover:decoration-[color:var(--accent-magenta)] hover:text-[color:var(--accent-magenta)]",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 text-[0.68rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[0.72rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[0.85rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9 rounded-full",
        "icon-xs":
          "size-7 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-full",
        "icon-lg": "size-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
