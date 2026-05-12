"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useShallow } from "zustand/shallow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import {
  createComment,
  editComment,
  deleteComment,
  resolveComment,
} from "@/actions/comments";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { CheckCircle2, CornerDownRight, Pencil, Quote, Reply, RotateCcw, Trash2 } from "lucide-react";
import {
  MentionPopover,
  type MentionPopoverHandle,
} from "@/components/board/card/mention-popover";
import type { CommentRow } from "@/lib/queries/board-snapshot";
import { undoBus } from "@/lib/undo-bus";
import { formatDateTime } from "@/lib/format-date";

export function CommentsSection({ cardId }: { cardId: string }) {
  const comments = useBoardStore(useShallow((s) => s.comments.filter((c) => c.cardId === cardId)));
  const profiles = useBoardStore((s) => s.boardProfiles);
  const boardMembers = useBoardStore((s) => s.boardMembers);
  const boardId = useBoardStore((s) => s.boardId);
  const addComment = useBoardStore((s) => s.addComment);
  const updateComment = useBoardStore((s) => s.updateComment);
  const removeComment = useBoardStore((s) => s.removeComment);

  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionRef = useRef<MentionPopoverHandle | null>(null);

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

  // Selector already filters to this card's comments (shallow equality).
  const cardComments = comments;
  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.displayName);
    return m;
  }, [profiles]);
  const profileByHandle = useMemo(() => {
    const m = new Map<string, { id: string; displayName: string; handle: string }>();
    for (const p of profiles) m.set(p.handle.toLowerCase(), p);
    return m;
  }, [profiles]);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, CommentRow[]>();
    for (const c of cardComments) {
      if (!c.parentCommentId) continue;
      const arr = m.get(c.parentCommentId) ?? [];
      arr.push(c);
      m.set(c.parentCommentId, arr);
    }
    return m;
  }, [cardComments]);
  const topLevelComments = useMemo(
    () => cardComments.filter((c) => !c.parentCommentId),
    [cardComments],
  );
  const isAdmin = useMemo(
    () =>
      currentUserId !== null &&
      boardMembers.some(
        (m) => m.userId === currentUserId && m.role === "admin",
      ),
    [boardMembers, currentUserId],
  );

  function submitNew() {
    const trimmed = body.trim();
    if (!trimmed) return;
    const parentCommentId = replyToId;
    const matchedMentions = Array.from(
      new Set(
        Array.from(trimmed.matchAll(/(^|\s)@([A-Za-z0-9_.-]{2,40})/g))
          .map((m) => m[2].toLowerCase())
          .filter((h) => profileByHandle.has(h)),
      ),
    );
    setBody("");
    setReplyToId(null);
    start(async () => {
      try {
        const row = await createComment({
          cardId,
          body: trimmed,
          parentCommentId,
        });
        addComment({
          id: row.id,
          cardId: row.cardId,
          boardId: row.boardId,
          authorId: row.authorId,
          parentCommentId: row.parentCommentId,
          body: row.body,
          createdAt: new Date(row.createdAt),
          editedAt: row.editedAt ? new Date(row.editedAt) : null,
          resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
          resolvedBy: row.resolvedBy,
        });
        if (matchedMentions.length > 0) {
          toast.success(
            `${matchedMentions.length} ${matchedMentions.length === 1 ? "teammate was" : "teammates were"} mentioned and notified`,
          );
        } else if (parentCommentId) {
          toast.success("Reply posted");
        }
        undoBus.push({
          message: parentCommentId ? "Reply posted" : "Comment posted",
          undo: async () => {
            removeComment(row.id);
            try {
              await deleteComment({ id: row.id });
            } catch (err) {
              addComment({
                id: row.id,
                cardId: row.cardId,
                boardId: row.boardId,
                authorId: row.authorId,
                parentCommentId: row.parentCommentId,
                body: row.body,
                createdAt: new Date(row.createdAt),
                editedAt: row.editedAt ? new Date(row.editedAt) : null,
                resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
                resolvedBy: row.resolvedBy,
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
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
    // Let the @-mention popover claim arrow / enter / escape first.
    if (mentionRef.current?.onKeyDown(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitNew();
    }
  }

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditingBody(current);
  }
  function startReply(c: CommentRow) {
    setReplyToId(c.parentCommentId ?? c.id);
    setBody("");
    queueMicrotask(() => composerRef.current?.focus());
  }
  function quoteComment(c: CommentRow) {
    const author = profileById.get(c.authorId) ?? "Someone";
    const quote = `> ${author}: ${c.body.replace(/\n/g, "\n> ")}\n\n`;
    setReplyToId(c.parentCommentId ?? c.id);
    setBody((curr) => `${quote}${curr}`);
    queueMicrotask(() => {
      composerRef.current?.focus();
      const end = quote.length;
      composerRef.current?.setSelectionRange(end, end);
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingBody("");
  }
  function saveEdit() {
    const id = editingId;
    const next = editingBody.trim();
    if (!id || !next) return;
    const prev = cardComments.find((c) => c.id === id);
    if (!prev || prev.body === next) {
      cancelEdit();
      return;
    }
    setEditingId(null);
    setEditingBody("");
    start(async () => {
      try {
        const row = await editComment({ id, body: next });
        updateComment(id, {
          body: row.body,
          editedAt: row.editedAt ? new Date(row.editedAt) : new Date(),
        });
        undoBus.push({
          message: "Comment edited",
          undo: async () => {
            updateComment(id, {
              body: prev.body,
              editedAt: prev.editedAt,
            });
            try {
              const restored = await editComment({ id, body: prev.body });
              updateComment(id, {
                body: restored.body,
                editedAt: restored.editedAt
                  ? new Date(restored.editedAt)
                  : new Date(),
              });
            } catch (err) {
              updateComment(id, {
                body: row.body,
                editedAt: row.editedAt ? new Date(row.editedAt) : new Date(),
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
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

  function onResolve(c: CommentRow, resolved: boolean) {
    const prev = c;
    updateComment(c.id, {
      resolvedAt: resolved ? new Date() : null,
      resolvedBy: resolved ? currentUserId : null,
    });
    start(async () => {
      try {
        const row = await resolveComment({ id: c.id, resolved });
        updateComment(c.id, {
          resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
          resolvedBy: row.resolvedBy,
          editedAt: row.editedAt ? new Date(row.editedAt) : prev.editedAt,
        });
        undoBus.push({
          message: resolved ? "Comment resolved" : "Comment reopened",
          undo: async () => {
            updateComment(c.id, {
              resolvedAt: prev.resolvedAt,
              resolvedBy: prev.resolvedBy,
              editedAt: prev.editedAt,
            });
            try {
              const restored = await resolveComment({
                id: c.id,
                resolved: !resolved,
              });
              updateComment(c.id, {
                resolvedAt: restored.resolvedAt
                  ? new Date(restored.resolvedAt)
                  : null,
                resolvedBy: restored.resolvedBy,
                editedAt: restored.editedAt
                  ? new Date(restored.editedAt)
                  : prev.editedAt,
              });
            } catch (err) {
              updateComment(c.id, {
                resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
                resolvedBy: row.resolvedBy,
                editedAt: row.editedAt ? new Date(row.editedAt) : prev.editedAt,
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        updateComment(c.id, prev);
        toast.error((err as Error).message);
      }
    });
  }

  function renderBody(text: string) {
    const out: React.ReactNode[] = [];
    const re = /(^|\s)@([A-Za-z0-9_.-]{2,40})/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const start = match.index + match[1].length;
      if (start > last) out.push(text.slice(last, start));
      const handle = match[2];
      const profile = profileByHandle.get(handle.toLowerCase());
      out.push(
        profile ? (
          <button
            key={`${start}-${handle}`}
            type="button"
            title={`Mention ${profile.displayName} in a reply`}
            onClick={() => {
              setBody((curr) =>
                curr.trim() ? `${curr.trimEnd()} @${handle} ` : `@${handle} `,
              );
              queueMicrotask(() => composerRef.current?.focus());
            }}
            className="rounded bg-[color:var(--accent-cyan)]/12 px-1 py-0.5 font-medium text-fg ring-1 ring-[color:var(--accent-cyan)]/30 hover:bg-[color:var(--accent-cyan)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent-cyan)]"
          >
            @{handle}
          </button>
        ) : (
          <span
            key={`${start}-${handle}`}
            title={`@${handle}`}
            className="rounded bg-fg/5 px-1 py-0.5 text-fg-muted"
          >
            @{handle}
          </span>
        ),
      );
      last = start + handle.length + 1;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function renderComment(c: CommentRow, depth = 0) {
    const isOwn = currentUserId !== null && c.authorId === currentUserId;
    const isEditing = editingId === c.id;
    const canModerate = isOwn || isAdmin;
    const replies = repliesByParent.get(c.id) ?? [];
    const isResolved = c.resolvedAt != null;
    return (
      <li
        key={c.id}
        data-comment-id={c.id}
        data-depth={depth}
        data-resolved={isResolved ? "true" : undefined}
        className={`rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm group/comment ${
          depth > 0 ? "ml-5" : ""
        } ${isResolved ? "opacity-75" : ""}`}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-hairline pb-1">
          <span className="mono-meta text-fg inline-flex items-center gap-1.5">
            {depth > 0 && <CornerDownRight className="size-3 text-fg-faint" />}
            {profileById.get(c.authorId) ?? "Unknown"}
            {isResolved && (
              <span className="chip mono-meta-sm text-[color:var(--status-done)]">
                RESOLVED
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <time className="mono-meta-sm text-fg-faint">
              {formatDateTime(c.createdAt)}
              {c.editedAt && <span className="ml-1 text-fg-faint">· edited</span>}
            </time>
            {!isEditing && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover/comment:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => startReply(c)}
                  aria-label="Reply to comment"
                  title="Reply"
                  className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                >
                  <Reply className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => quoteComment(c)}
                  aria-label="Quote comment"
                  title="Quote"
                  className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                >
                  <Quote className="size-3" />
                </button>
                {canModerate && depth === 0 && (
                  <button
                    type="button"
                    onClick={() => onResolve(c, !isResolved)}
                    aria-label={isResolved ? "Reopen comment thread" : "Resolve comment thread"}
                    title={isResolved ? "Reopen" : "Resolve"}
                    className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-[color:var(--status-done)] hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  >
                    {isResolved ? <RotateCcw className="size-3" /> : <CheckCircle2 className="size-3" />}
                  </button>
                )}
                {isOwn && (
                  <button
                    type="button"
                    onClick={() => startEdit(c.id, c.body)}
                    aria-label="Edit comment"
                    title="Edit"
                    className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
                {canModerate && (
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label={isOwn ? "Delete comment" : "Delete (admin)"}
                    title={isOwn ? "Delete" : "Delete (admin)"}
                    className="size-6 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-[color:var(--status-blocked)] hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
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
              <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={saveEdit} disabled={!editingBody.trim()}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-fg">{renderBody(c.body)}</p>
        )}
        {replies.length > 0 && (
          <ul className="mt-2 space-y-2">
            {replies.map((reply) => renderComment(reply, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <section className="space-y-3" data-testid="comments-section">
      <ul className="space-y-2" data-testid="comments-list">
        {topLevelComments.length === 0 && (
          <li className="text-sm text-fg-faint italic">No comments yet.</li>
        )}
        {topLevelComments.map((c) => renderComment(c))}
      </ul>
      <form onSubmit={onSubmit} className="space-y-2">
        {replyToId && (
          <div className="flex items-center justify-between rounded-lg border border-hairline bg-[color:var(--surface)] px-2 py-1 text-xs text-fg-muted">
            <span>
              Replying in thread with{" "}
              <span className="text-fg">
                {profileById.get(cardComments.find((c) => c.id === replyToId)?.authorId ?? "") ?? "Someone"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setReplyToId(null)}
              className="mono-meta-sm hover:text-fg"
            >
              CANCEL
            </button>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={composerRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            placeholder="Write a comment.  @mention works.  Cmd/Ctrl+Enter to send."
            rows={3}
            maxLength={20_000}
            aria-label="New comment"
            className="w-full rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-sm font-sans text-fg outline-none transition-colors hover:border-[color:var(--hairline-hi)] focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)] focus-visible:shadow-[0_0_0_3px_rgb(0_229_255/0.20)] placeholder:italic placeholder:text-fg-faint"
          />
          <MentionPopover
            ref={mentionRef}
            boardId={boardId}
            value={body}
            caret={caret}
            onChange={(next, nextCaret) => {
              setBody(next);
              setCaret(nextCaret);
              // Restore caret in the textarea after React re-renders.
              queueMicrotask(() => {
                if (composerRef.current) {
                  composerRef.current.focus();
                  composerRef.current.setSelectionRange(nextCaret, nextCaret);
                }
              });
            }}
          />
        </div>
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
