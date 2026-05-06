"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Subscribe to `workspace_members` changes for the signed-in user.  When
// somebody invites them or removes them, the topnav needs to re-fetch
// the workspaces list (which the (app) layout already pulls fresh, but
// only on a full request).  We trigger router.refresh() to bust the RSC
// payload and pick up the change without a hard reload.
export function useWorkspaceMembershipSync(userId: string) {
  const router = useRouter();
  useEffect(() => {
    if (!userId) return;
    const supa = createSupabaseBrowser();
    const channel = supa
      .channel(`workspace_members:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_members",
          filter: `user_id=eq.${userId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supa.removeChannel(channel);
    };
  }, [userId, router]);
}
