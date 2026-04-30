"use client";
// Plan #16b-β — `"use client"` re-export so server components (workspace
// pages, dashboard pages) can render the provider without bundling zustand
// into the server module graph.
export { WorkspaceStoreProvider } from "@/stores/workspace-store";
