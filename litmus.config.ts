import type { LitmusConfig } from "litmus";

export default {
  name: "trello-foundation",
  suites: [
    { name: "lint", runner: "cmd", cmd: "npm run lint" },
    { name: "type-check", runner: "cmd", cmd: "npm run type-check" },
    { name: "test:unit", runner: "vitest", paths: ["tests"], coverage: true },
    { name: "test:e2e", runner: "playwright", paths: ["tests/e2e"] },
  ],
} satisfies LitmusConfig;
