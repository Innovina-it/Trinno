import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Bake the building deployment's ID into the client bundle so a stale tab
  // can detect a newer live deployment (see components/system/version-watcher).
  // Empty locally / when System Env Vars are off → the watcher stays inert.
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? "",
  },
};

export default nextConfig;
