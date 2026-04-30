"use client";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceVersions } from "@/hooks/use-workspace-versions";
import { setCardVersion, clearCardVersion } from "@/actions/card-versions";

type Kind = "affects" | "fixes";

export function VersionCardSection({
  cardId,
  workspaceId,
}: {
  cardId: string;
  workspaceId: string;
}) {
  const versions = useWorkspaceVersions(workspaceId);
  const cardVersions = useBoardStore((s) => s.cardVersions);
  const addCardVersion = useBoardStore((s) => s.addCardVersion);
  const removeCardVersion = useBoardStore((s) => s.removeCardVersion);
  const [pending, start] = useTransition();

  const attachedByKind = useMemo(() => {
    const m: Record<Kind, Set<string>> = {
      affects: new Set(),
      fixes: new Set(),
    };
    for (const cv of cardVersions) {
      if (cv.cardId === cardId) m[cv.kind].add(cv.versionId);
    }
    return m;
  }, [cardVersions, cardId]);

  function attach(versionId: string, kind: Kind) {
    if (attachedByKind[kind].has(versionId)) return;
    addCardVersion({
      cardId,
      versionId,
      kind,
      workspaceId: "00000000-0000-0000-0000-000000000000",
    });
    start(async () => {
      try {
        await setCardVersion({ cardId, versionId, kind });
      } catch (err) {
        removeCardVersion(cardId, versionId, kind);
        toast.error((err as Error).message);
      }
    });
  }

  function detach(versionId: string, kind: Kind) {
    removeCardVersion(cardId, versionId, kind);
    start(async () => {
      try {
        await clearCardVersion({ cardId, versionId, kind });
      } catch (err) {
        addCardVersion({
          cardId,
          versionId,
          kind,
          workspaceId: "00000000-0000-0000-0000-000000000000",
        });
        toast.error((err as Error).message);
      }
    });
  }

  function renderRow(kind: Kind, label: string) {
    const ids = attachedByKind[kind];
    const attached = versions.filter((v) => ids.has(v.id));
    return (
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-version-row={kind}
      >
        <span className="mono-meta-sm text-ink/60 w-20">{label}</span>
        {attached.length === 0 ? (
          <span className="font-serif italic text-xs text-ink/40">none</span>
        ) : (
          attached.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => detach(v.id, kind)}
              data-version-id={v.id}
              data-version-kind={kind}
              disabled={pending}
              className="mono-meta-sm flex items-center gap-1.5 border border-fg px-2 py-1 transition-opacity hover:opacity-90 disabled:opacity-60"
              title="Click to detach"
            >
              <span className="tracking-wider">{v.name}</span>
              <span aria-hidden>×</span>
            </button>
          ))
        )}
        {versions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  aria-label={`Add ${label.toLowerCase()} version`}
                >
                  <Plus className="size-3" />
                </Button>
              }
            />
            <DropdownMenuContent>
              {versions.map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  onClick={() => attach(v.id, kind)}
                  data-version-pick={v.id}
                  data-version-kind={kind}
                >
                  <span className="flex-1">{v.name}</span>
                  {ids.has(v.id) && <span aria-hidden>✓</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-3" data-testid="versions-section">
      <div className="flex items-baseline justify-between border-b border-rule pb-1">
        <h3 className="mono-meta text-ink/70">Versions</h3>
        <span className="mono-meta-sm text-ink/35">V</span>
      </div>
      {versions.length === 0 ? (
        <p className="text-xs text-fg-faint italic">
          Define versions in workspace settings.
        </p>
      ) : (
        <div className="space-y-2">
          {renderRow("affects", "AFFECTS")}
          {renderRow("fixes", "FIXES")}
        </div>
      )}
    </section>
  );
}
