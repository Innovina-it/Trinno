import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // tsconfig has jsx: "preserve" for Next; the test bundler (oxc) needs an
  // explicit transform so component tests (.tsx) compile. Harmless for the
  // existing JSX-free node integration tests.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    setupFiles: [],
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
});
