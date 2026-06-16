"use client";

import { useState } from "react";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { UploadStep } from "./upload-step";
import { ReviewStep } from "./review-step";
import { BuildStep } from "./build-step";

type Phase = "upload" | "review" | "build";

export function ImportWizard() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [driveFolderId, setDriveFolderId] = useState("");

  return (
    <div className="mt-6 space-y-4">
      {phase === "upload" && (
        <UploadStep
          driveFolderId={driveFolderId}
          onDriveFolderId={setDriveFolderId}
          onExtracted={(p) => {
            setPlan(p);
            setPhase("review");
          }}
        />
      )}
      {phase === "review" && plan && (
        <ReviewStep
          plan={plan}
          onChange={setPlan}
          onBack={() => setPhase("upload")}
          onConfirm={() => setPhase("build")}
        />
      )}
      {phase === "build" && plan && (
        <BuildStep plan={plan} driveFolderId={driveFolderId} />
      )}
    </div>
  );
}
