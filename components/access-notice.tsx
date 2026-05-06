"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const NOTICE_COPY: Record<string, { title: string; body?: string }> = {
  removed: {
    title: "You no longer have access",
    body: "Your access to the workspace or board you were viewing was revoked.",
  },
};

// Render-less.  Reads `?notice=<key>` once on mount, toasts the matching
// message, then strips the query so refreshes don't repeat.
export function AccessNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const key = sp.get("notice");
    if (!key) return;
    const meta = NOTICE_COPY[key];
    if (meta) toast.error(meta.title, { description: meta.body });
    const next = new URLSearchParams(sp.toString());
    next.delete("notice");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, pathname, router]);
  return null;
}
