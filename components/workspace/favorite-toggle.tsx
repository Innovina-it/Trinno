"use client";
import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { toggleFavoriteBoard } from "@/actions/favorites";

/**
 * Plan #16b-γ-C (#4) — star button. Optimistic toggle; server
 * round-trip reconciles. The button stops event propagation so it can
 * sit inside the surrounding board-tile <Link> without navigating away.
 */
export function FavoriteToggle({
  boardId,
  initial,
  size = "md",
}: {
  boardId: string;
  initial: boolean;
  size?: "sm" | "md";
}) {
  const [favorited, setFavorited] = useState(initial);
  const [pending, start] = useTransition();

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !favorited;
    setFavorited(next);
    start(async () => {
      try {
        const r = await toggleFavoriteBoard({ boardId });
        if (r.favorited !== next) setFavorited(r.favorited);
      } catch (err) {
        setFavorited(!next);
        toast.error((err as Error).message);
      }
    });
  }

  const px = size === "sm" ? "size-3" : "size-4";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      data-testid="favorite-toggle"
      data-board-id={boardId}
      data-favorited={favorited ? "true" : "false"}
      aria-pressed={favorited}
      aria-label={favorited ? "Unfavorite board" : "Favorite board"}
      title={favorited ? "Unfavorite" : "Favorite"}
      className={`inline-flex items-center justify-center rounded p-1 text-fg-faint transition-colors hover:bg-[rgb(255_255_255/0.08)] hover:text-fg ${
        favorited ? "text-yellow-300 hover:text-yellow-200" : ""
      }`}
    >
      <Star
        className={px}
        fill={favorited ? "currentColor" : "none"}
        strokeWidth={1.5}
      />
    </button>
  );
}
