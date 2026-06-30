"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { ContributorOrgsPanel } from "@/components/workspace/contributor-orgs-panel";
import type { ContributorOrgRow } from "@/lib/pma/contributor-orgs-store";

// The "Contributors" row of the Analysis Setup panel: a collapsed disclosure
// over the contributor → organization mapping (moved here from workspace
// settings, where it was orphaned from the report it shapes). Collapsed by
// default with a live "N mapped" summary; the editing UI only appears on
// expand. The panel stays mounted while collapsed (hidden, not unmounted) so an
// owner/admin's in-session edits survive a collapse.
export function ContributorOrgsSection({
  workspaceId,
  initialRows,
  canEdit,
  orgHints = [],
}: {
  workspaceId: string;
  initialRows: ContributorOrgRow[];
  canEdit: boolean;
  orgHints?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialRows.length);

  return (
    <div data-testid="pma-contributors" className="py-3.5">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
          People
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="pma-contributors-body"
          className="group/disc -ml-1 flex items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40"
        >
          <span className="text-[0.8125rem] text-fg-muted transition-colors group-hover/disc:text-fg">
            {count === 0
              ? "No one mapped to an organization"
              : `${count} mapped to ${count === 1 ? "an organization" : "organizations"}`}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-fg-faint transition-transform duration-200 group-hover/disc:text-fg-muted",
              open ? "" : "-rotate-90",
            )}
          />
        </button>
      </div>

      <div
        id="pma-contributors-body"
        className={cn("mt-3.5", !open && "hidden")}
      >
        <ContributorOrgsPanel
          workspaceId={workspaceId}
          initialRows={initialRows}
          canEdit={canEdit}
          orgHints={orgHints}
          onCount={setCount}
        />
      </div>
    </div>
  );
}
