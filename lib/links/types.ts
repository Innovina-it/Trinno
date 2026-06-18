import type { DeliveryStatus } from "@/lib/links/status";

export type CardUrlLink = {
  id: string;
  cardId: string;
  url: string;
  color: string;
  status: DeliveryStatus | null;
};
export type WorkspaceLink = { id: string; workspaceId: string; url: string };
