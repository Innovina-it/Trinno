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
    <section className="space-y-2" data-testid="comments-section">
      <h3 className="text-sm font-semibold">Comments</h3>
      <ul className="space-y-2" data-testid="comments-list">
        {cardComments.length === 0 && (
          <li className="text-xs text-muted-foreground">No comments yet.</li>
        )}
        {cardComments.map((c) => (
          <li
            key={c.id}
            data-comment-id={c.id}
            className="rounded border border-border bg-muted/30 p-2 text-sm"
          >
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {profileById.get(c.authorId) ?? "Unknown"}
              </span>
              <time>{fmt(c.createdAt)}</time>
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
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
          className="w-full rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || body.trim().length === 0}>
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
