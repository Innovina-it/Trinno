"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlanAction } from "@/actions/plan-import";

type BuildFailure = { step: string; message: string };

export function BuildStep({
  plan,
  driveFolderId,
}: {
  plan: ProjectPlan;
  driveFolderId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"building" | "partial" | "error">("building");
  const [failures, setFailures] = useState<BuildFailure[]>([]);
  const [wsId, setWsId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await buildWorkspaceFromPlanAction({ plan, driveFolderId });
        if (cancelled) return;
        if (res.ok && res.workspaceId) {
          router.push(`/w/${res.workspaceId}/roadmap`);
          return;
        }
        setWsId(res.workspaceId);
        setFailures(res.failures);
        setStatus("partial");
      } catch (e) {
        if (!cancelled) {
          setFailures([{ step: "build", message: e instanceof Error ? e.message : "failed" }]);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, driveFolderId, router]);

  if (status === "building") {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Building your workspace…
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">
        {status === "partial" ? "Built with some issues." : "Build failed."}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[color:var(--accent-magenta)]">
        {failures.map((f, i) => (
          <li key={i}>
            {f.step}: {f.message}
          </li>
        ))}
      </ul>
      {wsId && (
        <Button type="button" variant="outline" onClick={() => router.push(`/w/${wsId}/roadmap`)}>
          Open the partial workspace
        </Button>
      )}
    </div>
  );
}
