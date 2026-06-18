"use client";
import { Link2, Cloud } from "lucide-react";
import { useLongPress } from "@/lib/hooks/use-long-press";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";

export type LinkIconVariant = "card" | "workspace";

function openUrl(url: string) {
  // The store may briefly hold the raw, un-normalized URL (optimistic
  // upsert echo arrives a tick later). `window.open` resolves a bare
  // host like "drive.google.com/x" as a path relative to the current
  // origin, so prepend the scheme defensively when it's missing.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  window.open(hasScheme ? url : `https://${url}`, "_blank", "noopener,noreferrer");
}

// Diamond = rotated square.
function Diamond({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: color }}
      className="inline-block rotate-45 rounded-[2px] shrink-0"
    />
  );
}

/**
 * - No link + canEdit  -> chain. Click = onEdit (create).
 * - Link set           -> diamond (card) / cloud (workspace). Click = open URL.
 *                         Hold ~500ms = onEdit (only when canEdit).
 * - No link + !canEdit -> renders nothing.
 */
export function LinkIcon({
  variant,
  url,
  color,
  canEdit,
  onEdit,
}: {
  variant: LinkIconVariant;
  url: string | null;
  color?: string | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const hasLink = !!url;
  const press = useLongPress({
    onClick: () => (hasLink ? openUrl(url!) : onEdit()),
    onLongPress: hasLink && canEdit ? onEdit : undefined,
  });

  if (!hasLink && !canEdit) return null;

  const label = !hasLink
    ? "Add link"
    : canEdit
      ? "Open link (hold, right-click, or F2 to edit)"
      : "Open link";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (hasLink) openUrl(url!);
          else onEdit();
        } else if (e.key === "F2" && hasLink && canEdit) {
          e.preventDefault();
          onEdit();
        }
      }}
      {...press}
      // After {...press}: overrides the hook's onContextMenu (which only
      // suppresses the menu on touch long-press) so right-click on an existing
      // link opens the edit dialog. Left-click still opens the URL; long-press
      // / F2 still edit. Viewers (no edit rights) keep the default menu.
      onContextMenu={(e) => {
        if (hasLink && canEdit) {
          e.preventDefault();
          onEdit();
        }
      }}
      className="inline-flex items-center justify-center size-6 rounded hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
      data-testid={`link-icon-${variant}`}
      data-haslink={hasLink ? "1" : "0"}
    >
      {!hasLink ? (
        <Link2 className="size-3.5 text-fg-faint" />
      ) : variant === "workspace" ? (
        <Cloud className="size-5" style={{ color: "var(--accent-cyan)" }} />
      ) : (
        <Diamond color={color || DEFAULT_LINK_COLOR} />
      )}
    </button>
  );
}
