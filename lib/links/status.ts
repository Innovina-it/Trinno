// Delivery status for card deliverables (cards that carry a link). This tag is
// SEPARATE from the Open/Done completion logic — it lives on the link row, so a
// card with no link has no status. NULL = no status set (no badge rendered).
//
// Labels stay in English to match the rest of the UI ("Open"/"Done", "Edit
// link"). This module is intentionally pure (no React/icon imports) so server
// query/validation code can import the type and value list freely; the badge
// maps each value to an icon on the client side.

export const DELIVERY_STATUSES = [
  "to_do",
  "in_progress",
  "delivered",
  "approved",
  "blocked",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  delivered: "Delivered",
  approved: "Approved",
  blocked: "Blocked",
};
