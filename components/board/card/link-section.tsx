"use client";
import { useCallback, useContext, useState, useSyncExternalStore } from "react";
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { StatusBadge } from "@/components/links/status-badge";
import { upsertCardLink, removeCardLink } from "@/actions/links";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";
import { toast } from "sonner";
import { BoardStoreContext } from "@/stores/board-store";
import { WorkspaceStoreContext } from "@/stores/workspace-store";
import type { CardUrlLink } from "@/lib/links/types";
import type { WorkspaceRole } from "@/lib/permissions/guest-guard";

/**
 * Self-contained card URL-link control for the extended card edit window.
 * Reads link state from BoardStoreContext and viewer role from
 * WorkspaceStoreContext via useSyncExternalStore, mirroring the quick-view
 * hooks (useQuickViewCardLink / useViewerRole). The modal only renders
 * <LinkSection cardId={...} />.
 */
export function LinkSection({ cardId }: { cardId: string }) {
  const { link, setCardLink, removeCardLinkLocal } = useCardLink(cardId);
  const viewerRole = useViewerRole();
  const canEdit = viewerRole === "owner" || viewerRole === "admin";
  const [open, setOpen] = useState(false);
  if (!link && !canEdit) return null;
  return (
    <div className="flex items-center gap-2" data-testid="card-link-section">
      <span className="text-xs text-fg-faint">Link</span>
      <LinkIcon
        variant="card"
        url={link?.url ?? null}
        color={link?.color ?? null}
        canEdit={canEdit}
        onEdit={() => setOpen(true)}
      />
      {link?.url && (
        <span className="truncate text-xs text-fg/80 max-w-[16rem]">
          {link.url}
        </span>
      )}
      {link?.url && <StatusBadge status={link.status} />}
      <LinkEditDialog
        open={open}
        onOpenChange={setOpen}
        scope="card"
        initialUrl={link?.url ?? ""}
        initialColor={link?.color ?? DEFAULT_LINK_COLOR}
        initialStatus={link?.status ?? null}
        onSave={async ({ url, color, status }) => {
          setCardLink({
            id: link?.id ?? "optimistic",
            cardId,
            url,
            color,
            status: status ?? null,
          });
          const res = await upsertCardLink({ cardId, url, color, status });
          if (res.ok) {
            setCardLink({
              id: res.data.id,
              cardId,
              url: res.data.url ?? url,
              color: res.data.color ?? color,
              status: res.data.status ?? null,
            });
          } else {
            toast.error(res.error.message);
          }
        }}
        onRemove={
          link
            ? async () => {
                removeCardLinkLocal(cardId);
                const res = await removeCardLink({ cardId });
                if (!res.ok) toast.error(res.error.message);
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Card-scoped URL link from the board store. Mirrors
 * card-quick-view.tsx's useQuickViewCardLink — subscribes via
 * useSyncExternalStore so the icon reflects optimistic + confirmed state,
 * and returns no-op setters when rendered outside a BoardStoreProvider.
 */
function useCardLink(cardId: string): {
  link: CardUrlLink | undefined;
  setCardLink: (l: CardUrlLink) => void;
  removeCardLinkLocal: (cardId: string) => void;
} {
  const boardStore = useContext(BoardStoreContext);
  const subscribe = useCallback(
    (cb: () => void) => boardStore?.subscribe(cb) ?? (() => {}),
    [boardStore],
  );
  const getLink = useCallback(
    () => boardStore?.getState().cardLinkByCard[cardId],
    [boardStore, cardId],
  );
  const link = useSyncExternalStore(subscribe, getLink, getLink);
  const setCardLink = useCallback(
    (l: CardUrlLink) => boardStore?.getState().setCardLink(l),
    [boardStore],
  );
  const removeCardLinkLocal = useCallback(
    (id: string) => boardStore?.getState().removeCardLinkLocal(id),
    [boardStore],
  );
  return { link, setCardLink, removeCardLinkLocal };
}

/** Viewer's workspace role from WorkspaceStoreContext. Mirrors
 *  card-quick-view.tsx's useViewerRole. null when rendered without store. */
function useViewerRole(): WorkspaceRole | null {
  const wsStore = useContext(WorkspaceStoreContext);
  const subscribe = useCallback(
    (cb: () => void) => wsStore?.subscribe(cb) ?? (() => {}),
    [wsStore],
  );
  const getRole = useCallback(
    () => wsStore?.getState().viewerRole ?? null,
    [wsStore],
  );
  return useSyncExternalStore(subscribe, getRole, getRole);
}
