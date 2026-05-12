"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive as ArchiveIcon, Undo2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { archiveCard } from "@/actions/cards";
import { archiveList } from "@/actions/lists";
import { setBoardArchived } from "@/actions/boards";
import type { WorkspaceArchive } from "@/lib/queries/archived";
import { formatDate } from "@/lib/format-date";

export function ArchiveView({
  archive,
}: {
  archive: WorkspaceArchive;
  workspaceId: string;
}) {
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const restoreCard = (id: string, title: string) => {
    setPending((p) => ({ ...p, [id]: true }));
    startTransition(async () => {
      try {
        await archiveCard({ id, archived: false });
        toast.success(`Restored "${title}"`);
      } catch (e) {
        toast.error((e as Error).message);
        setPending((p) => ({ ...p, [id]: false }));
      }
    });
  };

  const restoreList = (id: string, title: string) => {
    setPending((p) => ({ ...p, [id]: true }));
    startTransition(async () => {
      try {
        await archiveList({ id, archived: false });
        toast.success(`Restored "${title}"`);
      } catch (e) {
        toast.error((e as Error).message);
        setPending((p) => ({ ...p, [id]: false }));
      }
    });
  };

  const restoreBoard = (id: string, title: string) => {
    setPending((p) => ({ ...p, [id]: true }));
    startTransition(async () => {
      try {
        await setBoardArchived({ id, archived: false });
        toast.success(`Restored "${title}"`);
      } catch (e) {
        toast.error((e as Error).message);
        setPending((p) => ({ ...p, [id]: false }));
      }
    });
  };

  const totalEmpty =
    archive.cards.length + archive.lists.length + archive.boards.length === 0;

  if (totalEmpty) {
    return (
      <div className="rounded-2xl border border-hairline bg-[color:var(--surface)] p-12 text-center text-fg-faint">
        <ArchiveIcon className="mx-auto size-8 mb-3 text-fg-faint" />
        <p className="mono-meta-sm">No archived items in this workspace.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {archive.cards.length > 0 && (
        <section className="space-y-3" data-testid="archive-section-cards">
          <h2 className="text-base font-semibold">
            Cards · {archive.cards.length}
          </h2>
          <div className="rounded-2xl border border-hairline divide-y divide-hairline overflow-hidden">
            {archive.cards.map((c) => (
              <div
                key={c.id}
                data-testid="archive-card-row"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[rgb(255_255_255/0.03)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-fg truncate">{c.title}</div>
                  <div className="mono-meta-sm text-fg-faint truncate">
                    {c.boardTitle} · {c.listTitle} · {formatDate(c.createdAt)}
                  </div>
                </div>
                <Link
                  href={`/b/${c.boardId}/c/${c.id}`}
                  className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                  title="Open card"
                >
                  <ExternalLink className="size-3" />
                </Link>
                <button
                  type="button"
                  disabled={pending[c.id]}
                  onClick={() => restoreCard(c.id, c.title)}
                  data-testid="archive-restore-card"
                  className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
                >
                  <Undo2 className="size-3" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {archive.lists.length > 0 && (
        <section className="space-y-3" data-testid="archive-section-lists">
          <h2 className="text-base font-semibold">
            Lists · {archive.lists.length}
          </h2>
          <div className="rounded-2xl border border-hairline divide-y divide-hairline overflow-hidden">
            {archive.lists.map((l) => (
              <div
                key={l.id}
                data-testid="archive-list-row"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[rgb(255_255_255/0.03)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-fg truncate">{l.title}</div>
                  <div className="mono-meta-sm text-fg-faint truncate">
                    {l.boardTitle} · {formatDate(l.createdAt)}
                  </div>
                </div>
                <Link
                  href={`/b/${l.boardId}`}
                  className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                  title="Open board"
                >
                  <ExternalLink className="size-3" />
                </Link>
                <button
                  type="button"
                  disabled={pending[l.id]}
                  onClick={() => restoreList(l.id, l.title)}
                  data-testid="archive-restore-list"
                  className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
                >
                  <Undo2 className="size-3" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {archive.boards.length > 0 && (
        <section className="space-y-3" data-testid="archive-section-boards">
          <h2 className="text-base font-semibold">
            Boards · {archive.boards.length}
          </h2>
          <div className="rounded-2xl border border-hairline divide-y divide-hairline overflow-hidden">
            {archive.boards.map((b) => (
              <div
                key={b.id}
                data-testid="archive-board-row"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[rgb(255_255_255/0.03)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-fg truncate">{b.title}</div>
                  <div className="mono-meta-sm text-fg-faint">
                    {formatDate(b.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending[b.id]}
                  onClick={() => restoreBoard(b.id, b.title)}
                  data-testid="archive-restore-board"
                  className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
                >
                  <Undo2 className="size-3" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
