import type { LitmusPlaybook } from "litmus";

export default {
  project: "trello-foundation",
  runOrder: ["lint", "type-check", "test:unit", "test:e2e"],
  triggers: [
    { filesMatch: "actions/**", runSuites: ["type-check", "test:unit"] },
    { filesMatch: "lib/**", runSuites: ["type-check", "test:unit"] },
    { filesMatch: "components/**", runSuites: ["lint", "type-check", "test:unit"] },
    { filesMatch: "app/**", runSuites: ["lint", "type-check"] },
    { filesMatch: "supabase/migrations/**", runSuites: ["test:unit"] },
    { filesMatch: "tests/**", runSuites: ["test:unit"] },
    { filesMatch: "tests/e2e/**", runSuites: ["test:e2e"] },
  ],
  diagnosis: [
    {
      suite: "test:unit",
      steps: [
        "Local Supabase auth rate-limit trips makeUser → null user → 'Cannot read id/access_token'.",
        "Bump auth.rate_limit.sign_in_sign_ups + token_refresh + token_verifications in supabase/config.toml.",
        "Recreate auth container: supabase stop --no-backup && supabase start.",
        "Re-run isolated: npx vitest run tests/integration/<file>.test.ts",
      ],
    },
    {
      suite: "test:e2e",
      steps: [
        "OS inotify watch limit blocks Next dev under turbopack.",
        "sudo sysctl -w fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=1024",
        "Restart next dev, then re-run.",
      ],
    },
  ],
  knownFlakes: [],
  definitionOfDone: {
    requiredSuites: ["lint", "type-check", "test:unit"],
    minCoverage: 70,
    stableForDays: 2,
  },
} satisfies LitmusPlaybook;
