"use client";

import { useRouter } from "next/navigation";
import { useTabSync } from "@/lib/use-tab-sync";

export function BoardSyncMount({ boardId }: { boardId: string }) {
  const router = useRouter();
  useTabSync({
    onBoardRefresh: (event) => {
      if (event.boardId === boardId) {
        router.refresh();
      }
    },
  });
  return null;
}
