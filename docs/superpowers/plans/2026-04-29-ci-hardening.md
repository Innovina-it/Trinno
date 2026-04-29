# Trello Clone — CI + E2E Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Stand up a GitHub Actions matrix that runs lint, unit/integration, and E2E on every PR, with proper Supabase service container; tighten any remaining flaky tests; add tooling that catches issues earlier. Final slice — leaves the project in a "ready to merge to main" state.

**Architecture:** GitHub Actions workflow `ci.yml` with three jobs:
1. **lint** — `npm run lint` + `npx tsc --noEmit`.
2. **integration** — `supabase start` (Docker) → `npm run test:unit`.
3. **e2e** — `supabase start` + `npm run dev` background + `npx playwright test`.

Caches: `~/.npm`, `.next/cache`, `~/.cache/ms-playwright`, Supabase Docker images via the official setup-supabase action.

**Definition of done:**
- `.github/workflows/ci.yml` runs on every PR + push to `main`.
- All three jobs green on a clean checkout.
- Branch is rebased on `main`, ready for the user to merge or open a PR.
- Optional: pre-commit hook for lint + tsc (skip if Husky adds friction).

---

## Slice A — npm scripts polish

- [ ] **Modify `package.json` scripts:**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "type-check": "tsc --noEmit",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "db:reset": "supabase db reset",
  "ci:lint": "npm run lint && npm run type-check",
  "ci:unit": "vitest run --reporter=default",
  "ci:e2e": "playwright test --reporter=line"
}
```

- [ ] **Commit:** `chore(scripts): add ci:lint / ci:unit / ci:e2e + type-check`

---

## Slice B — GitHub Actions workflow

- [ ] **Create `.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run ci:lint

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: npm ci
      - run: supabase start
        env:
          SUPABASE_HOSTNAME: 127.0.0.1
      - name: Capture env
        run: |
          {
            supabase status -o env | sed -E \
              -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/' \
              -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/' \
              -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' \
              -e 's/^DB_URL=/DATABASE_URL=/'
          } > .env.local
      - run: npm run ci:unit
      - if: always()
        run: supabase stop --no-backup

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: supabase start
      - name: Capture env
        run: |
          {
            supabase status -o env | sed -E \
              -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/' \
              -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/' \
              -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' \
              -e 's/^DB_URL=/DATABASE_URL=/'
          } > .env.local
      - run: npm run ci:e2e
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
      - if: always()
        run: supabase stop --no-backup
```

- [ ] **Commit:** `ci(github-actions): add lint + integration + e2e matrix`

---

## Slice C — flake hardening

The local E2E suite passes consistently with `workers: 1` in `playwright.config.ts`. Verify this is still set and survives CI. If any of the existing E2E specs are timing-sensitive in a way that survives locally but flakes on CI runners, document but do not over-engineer; CI flakes can be addressed in a follow-up.

Verify that `next.config.ts` has `outputFileTracingRoot` set to the project root (already done in Plan #2 to avoid the parent-lockfile warning).

- [ ] **Step 1:** Inspect `playwright.config.ts` and `next.config.ts`. Confirm.
- [ ] **Step 2:** If anything is missing, fix it and commit `chore(ci): pin Playwright workers + Next.js tracing root`.
- [ ] **Step 3:** If everything is already in shape, no commit needed.

---

## Slice D — README update + final summary

- [ ] **Modify `README.md`** — add a "CI" section pointing to GitHub Actions, plus a short "Project status" subsection listing what's shipped (auth, workspaces, boards, lists+cards+drag, realtime, card features, activity, search).
- [ ] **Commit:** `docs(readme): CI section + project status`

---

## Slice E — final verification

- All integration tests pass.
- All E2E pass.
- `npm run build` clean.
- `npm run lint` clean.
- `npx tsc --noEmit` clean.

---

## Self-Review Notes

- **Spec coverage:** §9.2 CI matrix (lint/integration/e2e jobs). All three present. Caches included.
- **Out of scope:** ArgoCD / GitOps deployment, branch protection rules, automated dependency updates (Renovate), code coverage upload.
- **CI runtime estimate:** ~6-10 min per PR (1 min lint, 3-4 min integration, 4-5 min e2e). Can be parallelized with separate runners.
- **Plan-author hazards:**
  - The `supabase start` step on `ubuntu-latest` may take 60-90 s the first time (Docker image pull). Subsequent runs cached.
  - Mailpit at port 54324 needs to be available for E2E to fetch confirmation emails. Default `supabase start` brings it up.
  - The Playwright cache key uses `package-lock.json` hash — invalidates when deps change. Browsers re-download (~600 MB) on cache miss; this is the long pole.
  - Some CI runners deny `--with-deps` (sudo); fall back to `npx playwright install chromium` if needed.
