import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: [],
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
});
