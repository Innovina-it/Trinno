// Link writes are owner/admin-only (member + guest are read-only).
import { StructuredError } from "@/lib/errors";
import type { WorkspaceRole } from "@/lib/permissions/guest-guard";

export function assertWorkspaceWriter(role: WorkspaceRole): void {
  if (role !== "owner" && role !== "admin") {
    throw new StructuredError("ACCESS_DENIED", "Forbidden", { role });
  }
}
