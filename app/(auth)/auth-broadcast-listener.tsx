"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { subscribeAuthEvents } from "@/lib/auth/broadcast";

export function AuthBroadcastListener() {
  const router = useRouter();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTH_BROADCAST === "false") {
      return undefined;
    }

    return subscribeAuthEvents((event) => {
      if (event.type === "signed-out") {
        router.push("/login");
      } else if (
        event.type === "signed-in" ||
        event.type === "token-refreshed"
      ) {
        router.refresh();
      } else if (event.type === "session-expired") {
        toast.error("Session expired", {
          description: "Sign in again to continue.",
        });
        window.location.href = "/login";
      }
    });
  }, [router]);

  return null;
}
