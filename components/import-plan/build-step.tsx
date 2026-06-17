"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlanAction } from "@/actions/plan-import";
import type { DriveMode } from "./upload-step";

type BuildFailure = { step: string; message: string };

export function BuildStep({
  plan,
  driveMode,
  driveFolderId,
  applyOwners,
}: {
  plan: ProjectPlan;
  driveMode: DriveMode;
  driveFolderId: string;
  applyOwners: boolean;
}) {
  const [status, setStatus] = useState<"building" | "partial" | "error">("building");
  const [failures, setFailures] = useState<BuildFailure[]>([]);
  const [wsId, setWsId] = useState<string | null>(null);
  // One-shot guard: the build fires exactly once. React StrictMode (dev)
  // mounts → unmounts → remounts; the ref persists across that, so the action
  // runs a single time. We do NOT use a `cancelled` cleanup flag here: under
  // StrictMode the first unmount would set it true, and since the remount hits
  // this guard and returns early, the in-flight result would be discarded and
  // the spinner would hang forever. The result must always be handled.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await buildWorkspaceFromPlanAction({ plan, driveMode, driveFolderId, applyOwners });
        if (res.ok && res.workspaceId) {
          // Hard navigation: a router.push here (in an effect, right after a
          // server action that called revalidatePath) gets swallowed by the
          // App Router. assign() reliably lands on the freshly built workspace.
          window.location.assign(`/w/${res.workspaceId}/roadmap`);
          return;
        }
        setWsId(res.workspaceId);
        setFailures(res.failures);
        setStatus("partial");
      } catch (e) {
        setFailures([{ step: "build", message: e instanceof Error ? e.message : "failed" }]);
        setStatus("error");
      }
    })();
  }, [plan, driveMode, driveFolderId, applyOwners]);

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
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.assign(`/w/${wsId}/roadmap`)}
        >
          Open the partial workspace
        </Button>
      )}
    </div>
  );
}
