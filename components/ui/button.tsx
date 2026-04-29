import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Editorial-industrial: square-cornered, mono-leaning weight, ink-on-paper.
  // Hover and active states use signal orange marks rather than fills.
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-signal aria-invalid:text-signal [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary: ink block, paper text, signal-orange chevron implied by adjacent svg
        default:
          "bg-ink text-paper hover:bg-ink/85 [&_svg]:text-signal",
        outline:
          "border-ink/80 bg-paper text-ink hover:border-ink hover:bg-paper-shadow aria-expanded:bg-paper-shadow",
        secondary:
          "bg-paper-shadow text-ink hover:bg-paper border border-ink/30 hover:border-ink/60 aria-expanded:bg-paper",
        ghost:
          "text-ink hover:text-signal aria-expanded:text-signal",
        destructive:
          "bg-paper text-signal border border-signal hover:bg-signal hover:text-paper",
        link:
          "text-ink underline underline-offset-4 hover:text-signal hover:decoration-signal",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-[0.68rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.72rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-3.5 text-[0.85rem] tracking-wider uppercase has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7",
        "icon-lg": "size-9",
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
