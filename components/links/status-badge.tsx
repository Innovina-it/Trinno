import { Ban, CheckCircle2, Circle, CircleDot, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@/lib/links/status";

// Neutral text pill for a deliverable's delivery status. Channel separation by
// design: the link diamond already carries a user-chosen COLOUR, so the status
// is read from TEXT + icon in a low-chroma outline badge — never a second
// competing colour. Renders nothing when there is no status.
const STATUS_ICONS: Record<DeliveryStatus, LucideIcon> = {
  to_do: Circle,
  in_progress: CircleDot,
  delivered: Send,
  approved: CheckCircle2,
  blocked: Ban,
};

export function StatusBadge({
  status,
  className,
}: {
  status: DeliveryStatus | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  const Icon = STATUS_ICONS[status];
  return (
    <Badge
      variant="outline"
      className={className}
      data-testid={`link-status-badge-${status}`}
    >
      <Icon aria-hidden />
      {DELIVERY_STATUS_LABELS[status]}
    </Badge>
  );
}
