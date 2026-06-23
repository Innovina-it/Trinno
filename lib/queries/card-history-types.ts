// Pure type module shared by the server query (`card-history.ts`)
// and the client hook (`use-card-history.ts`). No runtime imports
// here — safe for the browser bundle.

// Safety ceiling on how many history events one card surfaces. The feed
// pages through these client-side; beyond the ceiling the UI discloses
// the cap explicitly rather than dropping rows silently. Shared so the
// server fetch, the page slicer, and the modal's end-note all agree.
export const HISTORY_CEILING = 1000;

export type CardHistoryRow =
  | {
      kind: "field";
      id: string;
      cardId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      actorId: string | null;
      actorName: string | null;
      at: Date;
    }
  | {
      kind: "sprint";
      id: string;
      cardId: string;
      sprintId: string | null;
      sprintName: string | null;
      assignedAt: Date;
      removedAt: Date | null;
      at: Date;
    };
