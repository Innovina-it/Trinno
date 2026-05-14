// Pure type module shared by the server query (`card-history.ts`)
// and the client hook (`use-card-history.ts`). No runtime imports
// here — safe for the browser bundle.

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
