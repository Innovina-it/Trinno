import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // The plan-import build patches the ARISE .docx skeleton per deliverable
  // (lib/plan-import/docx-template.ts reads it at runtime). It lives in the
  // seeds tree, which Next does not trace automatically — include it explicitly
  // for the import page (the build server action) and the extract route so the
  // deliverable docs work on the deployed server, not only locally.
  outputFileTracingIncludes: {
    "/import-plan": ["./scripts/seeds/templates/arise.docx"],
    "/api/import-plan/**": ["./scripts/seeds/templates/arise.docx"],
  },
  // Bake the building deployment's ID into the client bundle so a stale tab
  // can detect a newer live deployment (see components/system/version-watcher).
  // Empty locally / when System Env Vars are off → the watcher stays inert.
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? "",
  },
};

export default nextConfig;
