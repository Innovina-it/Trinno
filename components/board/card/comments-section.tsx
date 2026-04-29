"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { createComment } from "@/actions/comments";

function fmt(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleString();
}

export function CommentsSection({ cardId }: { cardId: string }) {
  const comments = useBoardStore((s) => s.comments);
  const profiles = useBoardStore((s) => s.boardProfiles);
  const addComment = useBoardStore((s) => s.addComment);

  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const cardComments = useMemo(
    () => comments.filter((c) => c.cardId === cardId),
    [comments, cardId],
  );
  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.displayName);
    return m;
  }, [profiles]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setBody("");
    start(async () => {
      try {
        const row = await createComment({ cardId, body: trimmed });
        addComment({
          id: row.id,
          cardId: row.cardId,
          boardId: row.boardId,
          authorId: row.authorId,
          body: row.body,
          createdAt: new Date(row.createdAt),
          editedAt: row.editedAt ? new Date(row.editedAt) : null,
        });
      } catch (err) {
        // Surface the failure but don't restore body — the user can retype.
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="comments-section">
      <div className="flex items-baseline justify-between border-b border-rule pb-1">
        <h3 className="mono-meta text-ink/70">Comments</h3>
        <span className="mono-meta-sm text-ink/35">CM</span>
      </div>
      <ul className="space-y-2" data-testid="comments-list">
        {cardComments.length === 0 && (
          <li className="font-serif italic text-sm text-ink/50">No comments yet.</li>
        )}
        {cardComments.map((c) => (
          <li
            key={c.id}
            data-comment-id={c.id}
            className="border border-rule bg-paper-shadow/50 p-3 text-sm"
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-rule pb-1">
              <span className="mono-meta text-ink">
                {profileById.get(c.authorId) ?? "Unknown"}
              </span>
              <time className="mono-meta-sm text-ink/45">{fmt(c.createdAt)}</time>
            </div>
            <p className="whitespace-pre-wrap text-ink">{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          maxLength={20_000}
          aria-label="New comment"
          className="w-full rounded-none border border-ink/70 bg-paper-shadow p-2.5 text-sm font-sans outline-none transition-colors focus-visible:border-ink focus-visible:bg-paper placeholder:font-serif placeholder:italic placeholder:text-ink/45"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
