"use client";

import { useEffect, useState } from "react";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { UploadStep } from "./upload-step";
import { ReviewStep } from "./review-step";
import { BuildStep } from "./build-step";
import { WizardStepper, type WizardPhase } from "./wizard-stepper";

export function ImportWizard() {
  const [phase, setPhase] = useState<WizardPhase>("upload");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [applyOwners, setApplyOwners] = useState(true);

  // The steps carry interactive form inputs whose base-ui ids derive from
  // React useId; server-rendering them desyncs the ids at hydration. The wizard
  // is fully interactive and behind auth (no SSR value), so mount the steps
  // client-side only. The stepper has no inputs and renders on the server fine.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="mt-6 space-y-6">
      <WizardStepper current={phase} />
      {mounted && phase === "upload" && (
        <UploadStep
          driveFolderId={driveFolderId}
          onDriveFolderId={setDriveFolderId}
          onExtracted={(p) => {
            setPlan(p);
            setPhase("review");
          }}
        />
      )}
      {mounted && phase === "review" && plan && (
        <ReviewStep
          plan={plan}
          onChange={setPlan}
          applyOwners={applyOwners}
          onApplyOwners={setApplyOwners}
          onBack={() => setPhase("upload")}
          onConfirm={() => setPhase("build")}
        />
      )}
      {mounted && phase === "build" && plan && (
        <BuildStep plan={plan} driveFolderId={driveFolderId} applyOwners={applyOwners} />
      )}
    </div>
  );
}
