"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import {
  createComment,
  editComment,
  deleteComment,
} from "@/actions/comments";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Pencil, Trash2 } from "lucide-react";

function fmt(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleString();
}

export function CommentsSection({ cardId }: { cardId: string }) {
  const comments = useBoardStore((s) => s.comments);
  const profiles = useBoardStore((s) => s.boardProfiles);
  const addComment = useBoardStore((s) => s.addComment);
  const updateComment = useBoardStore((s) => s.updateComment);
  const removeComment = useBoardStore((s) => s.removeComment);

  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Resolve the viewer's auth uid once. Owner-only edit/delete affordance
  // hides for non-owners; the server still enforces via RLS.
  useEffect(() => {
    let cancelled = false;
    const supa = createSupabaseBrowser();
    supa.auth.getUser().then(({ data }) => {
      if (!cancelled) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cardComments = useMemo(
    () => comments.filter((c) => c.cardId === cardId),
    [comments, cardId],
  );
  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.displayName);
    return m;
  }, [profiles]);

  function submitNew() {
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
        toast.error((err as Error).message);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitNew();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitNew();
    }
  }

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditingBody(current);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingBody("");
  }
  function saveEdit() {
    const id = editingId;
    const next = editingBody.trim();
    if (!id || !next) return;
    setEditingId(null);
    setEditingBody("");
    start(async () => {
      try {
        const row = await editComment({ id, body: next });
        updateComment(id, {
          body: row.body,
          editedAt: row.editedAt ? new Date(row.editedAt) : new Date(),
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }
  function onEditKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  function onDelete(id: string) {
    if (!confirm("Delete this comment?")) return;
    const snapshot = cardComments.find((c) => c.id === id);
    if (!snapshot) return;
    removeComment(id);
    start(async () => {
      try {
        await deleteComment({ id });
      } catch (err) {
        toast.error((err as Error).message);
        addComment(snapshot);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="comments-section">
      <ul className="space-y-2" data-testid="comments-list">
        {cardComments.length === 0 && (
          <li className="text-sm text-fg-faint italic">No comments yet.</li>
        )}
        {cardComments.map((c) => {
          const isOwn = currentUserId !== null && c.authorId === currentUserId;
          const isEditing = editingId === c.id;
          return (
            <li
              key={c.id}
              data-comment-id={c.id}
              className="rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm group/comment"
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-hairline pb-1">
                <span className="mono-meta text-fg">
                  {profileById.get(c.authorId) ?? "Unknown"}
                </span>
                <div className="flex items-center gap-2">
                  <time className="mono-meta-sm text-fg-faint">
                    {fmt(c.createdAt)}
                    {c.editedAt && (
                      <span className="ml-1 text-fg-faint">· edited</span>
                    )}
                  </time>
                  {isOwn && !isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/comment:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => startEdit(c.id, c.body)}
                        aria-label="Edit comment"
                        title="Edit"
                        className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(c.id)}
                        aria-label="Delete comment"
                        title="Delete"
                        className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-[color:var(--status-blocked)] hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    onKeyDown={onEditKey}
                    rows={3}
                    className="w-full rounded-md border border-hairline bg-[color:var(--surface)] p-2 text-sm font-sans text-fg outline-none hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveEdit}
                      disabled={!editingBody.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-fg">{c.body}</p>
              )}
            </li>
          );
        })}
      </ul>
      <form onSubmit={onSubmit} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a comment. Cmd/Ctrl+Enter to send."
          rows={3}
          maxLength={20_000}
          aria-label="New comment"
          className="w-full rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm font-sans text-fg outline-none transition-colors hover:border-[color:var(--hairline-hi)] focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)] focus-visible:shadow-[0_0_0_3px_rgb(0_229_255/0.20)] placeholder:italic placeholder:text-fg-faint"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={pending || body.trim().length === 0}
          >
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
