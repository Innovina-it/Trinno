import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.local" });

// Stryker-scoped vitest config. Mirrors vitest.config.ts but narrows
// test.include to ONLY the invitation integration tests (all currently
// passing) so mutation results are not drowned out by the ~33 unrelated
// pre-existing failures in the full suite.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: [],
    include: [
      "tests/integration/workspace-invitations.test.ts",
      "tests/integration/invite-domain-carveout.test.ts",
      "tests/integration/invite-failure.test.ts",
      "tests/integration/invite-race.test.ts",
      "tests/unit/invite-email.test.ts",
    ],
    testTimeout: 15000,
  },
});
