import { cn } from "@/lib/utils";

// Editorial pull-quote empty state. Big italic serif headline, mono caption
// below, optional action. Hairline border in place of a soft container.
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 border border-rule paper-grid px-6 py-16 text-center",
        className,
      )}
    >
      {icon && (
        <div className="flex size-10 items-center justify-center border border-ink text-ink [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="pull-quote text-4xl md:text-5xl text-ink/85">
        &ldquo;{title}&rdquo;
      </p>
      {description && (
        <p className="mono-meta mx-auto max-w-md text-ink/55">{description}</p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
