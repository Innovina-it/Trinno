#!/usr/bin/env bash
# scripts/seeds/run.sh — safe seed-script runner
#
# Handles every gotcha we hit during the AIWEPI seeding session:
#  - Routes a seed script to LOCAL Supabase or PROD Supabase explicitly.
#  - Pulls prod env via `vercel env pull`. When the resulting values are
#    empty (Vercel "Sensitive" flag — CLI cannot decrypt these to disk),
#    falls back to an interactive prompt that reads the service-role key
#    via `read -rs` so it never lands in shell history.
#  - Writes a one-off env file at /tmp/.seed-env.<pid> with mode 600.
#  - Passes that path to the seed script via SEED_ENV_FILE — supported
#    by every script under scripts/seeds/*.mjs.
#  - Shreds the temp file on exit, even on Ctrl-C.
#  - Forwards optional --reset flag → SEED_RESET=true.
#  - <seed-script> can be either a bare name ("aiwepi", "testbed-500-cards")
#    auto-resolved against scripts/seeds/, OR a path.
#
# Usage:
#   ./scripts/seeds/run.sh local <seed-name|path> [--reset]
#   ./scripts/seeds/run.sh prod  <seed-name|path> [--reset]
#
# Examples:
#   ./scripts/seeds/run.sh local testbed-500-cards
#   ./scripts/seeds/run.sh prod  aiwepi --reset
#   SEED_EMAIL=alice@innovina.it ./scripts/seeds/run.sh prod aiwepi

set -euo pipefail

VERCEL_BIN="${VERCEL_BIN:-vercel}"
NODE_BIN="${NODE_BIN:-node}"
SUPABASE_DASHBOARD_URL="${SUPABASE_DASHBOARD_URL:-https://supabase.com/dashboard/project/xndddfopnlrzkydtnjxo/settings/api}"
SUPABASE_PROD_URL_DEFAULT="${SUPABASE_PROD_URL_DEFAULT:-https://xndddfopnlrzkydtnjxo.supabase.co}"

usage() {
  sed -n '2,30p' "$0"
  exit 64
}

[[ $# -ge 2 ]] || usage
TARGET="$1"
SCRIPT="$2"
shift 2
RESET=""
for arg in "$@"; do
  case "$arg" in
    --reset) RESET="1" ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $arg" >&2; usage ;;
  esac
done

# Auto-resolve bare seed names (e.g. "aiwepi", "testbed-500-cards") to
# scripts/seeds/<name>.mjs so the user doesn't have to type the full path.
if [[ ! -f "$SCRIPT" ]]; then
  SEEDS_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [[ -f "$SEEDS_DIR/$SCRIPT.mjs" ]]; then
    SCRIPT="$SEEDS_DIR/$SCRIPT.mjs"
  elif [[ -f "$SEEDS_DIR/$SCRIPT" ]]; then
    SCRIPT="$SEEDS_DIR/$SCRIPT"
  else
    echo "Seed script not found: $SCRIPT (looked under $SEEDS_DIR/)" >&2
    echo "Available:" >&2
    ls "$SEEDS_DIR"/*.mjs 2>/dev/null \
      | xargs -n1 basename \
      | sed 's/\.mjs$//' \
      | grep -v '^testbed-common$' \
      | sed 's/^/  /' >&2
    exit 1
  fi
fi

# Refuse to run the shared helper module directly.
if [[ "$(basename "$SCRIPT")" == "testbed-common.mjs" ]]; then
  echo "$SCRIPT is a shared module, not a runnable seed." >&2
  exit 1
fi

ENV_FILE="/tmp/.seed-env.$$"
cleanup() {
  if [[ -f "$ENV_FILE" ]]; then
    shred -u "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"
  fi
}
trap cleanup EXIT INT TERM

write_env() {
  local url="$1"
  local key="$2"
  umask 077
  cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$url
SUPABASE_SERVICE_ROLE_KEY=$key
EOF
  chmod 600 "$ENV_FILE"
}

case "$TARGET" in
  local)
    echo "Target: LOCAL Supabase (.env.local)"
    if [[ ! -f .env.local ]]; then
      echo "Missing .env.local. Run 'supabase start' and 'vercel env pull --environment=development .env.local' first." >&2
      exit 1
    fi
    URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
    KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
    if [[ -z "$URL" || -z "$KEY" ]]; then
      echo "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local" >&2
      exit 1
    fi
    write_env "$URL" "$KEY"
    ;;
  prod)
    echo "Target: PROD Supabase (writes to live data)"
    echo "Pulling production env via Vercel CLI..."
    if ! command -v "$VERCEL_BIN" >/dev/null 2>&1; then
      # Fall back to the nvm-prefixed path that's most common on this machine.
      if [[ -x "/home/innovina/.nvm/versions/node/v22.22.1/bin/vercel" ]]; then
        VERCEL_BIN="/home/innovina/.nvm/versions/node/v22.22.1/bin/vercel"
      else
        echo "vercel CLI not on PATH. Install: npm i -g vercel" >&2
        exit 1
      fi
    fi
    TMP_VERCEL="/tmp/.vercel-pull.$$"
    "$VERCEL_BIN" env pull --environment=production --yes "$TMP_VERCEL" >/dev/null 2>&1 || true
    URL=""
    KEY=""
    if [[ -s "$TMP_VERCEL" ]]; then
      URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$TMP_VERCEL" | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
      KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$TMP_VERCEL" | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
    fi
    shred -u "$TMP_VERCEL" 2>/dev/null || rm -f "$TMP_VERCEL"

    if [[ -z "$URL" || -z "$KEY" ]]; then
      echo "Vercel pull returned empty values (Sensitive flag — values are not decrypted to disk by the CLI)."
      echo "Get them from Supabase Studio: $SUPABASE_DASHBOARD_URL"
      echo
      read -rp "NEXT_PUBLIC_SUPABASE_URL [$SUPABASE_PROD_URL_DEFAULT]: " URL_IN
      URL="${URL_IN:-$SUPABASE_PROD_URL_DEFAULT}"
      echo -n "SUPABASE_SERVICE_ROLE_KEY (input hidden): "
      read -rs KEY
      echo
      [[ -n "$KEY" ]] || { echo "service-role key required" >&2; exit 1; }
    fi
    write_env "$URL" "$KEY"
    ;;
  *)
    echo "Unknown target: $TARGET (expected 'local' or 'prod')" >&2
    usage
    ;;
esac

# Sanity: refuse to run prod seed against a localhost URL (and vice versa).
URL_HOST=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | sed 's/^[^=]*=//')
if [[ "$TARGET" == "prod" && "$URL_HOST" == *"127.0.0.1"* ]]; then
  echo "Refusing: target=prod but URL points at 127.0.0.1" >&2; exit 1
fi
if [[ "$TARGET" == "local" && "$URL_HOST" != *"127.0.0.1"* && "$URL_HOST" != *"localhost"* && "$URL_HOST" != *"192.168."* ]]; then
  echo "Refusing: target=local but URL is not localhost" >&2; exit 1
fi

echo
echo "Running $SCRIPT against $TARGET..."
echo "    SEED_ENV_FILE=$ENV_FILE"
[[ -n "$RESET" ]] && echo "    SEED_RESET=true"
echo

# Forward optional SEED_EMAIL from the caller's env so it can be set
# inline as e.g. `SEED_EMAIL=alice@innovina.it ./run.sh prod ...`.
if [[ -n "$RESET" ]]; then
  SEED_ENV_FILE="$ENV_FILE" SEED_RESET=true "$NODE_BIN" "$SCRIPT"
else
  SEED_ENV_FILE="$ENV_FILE" "$NODE_BIN" "$SCRIPT"
fi
