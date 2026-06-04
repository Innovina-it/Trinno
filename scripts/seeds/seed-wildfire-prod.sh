#!/usr/bin/env bash
# One-shot prod seeder for mars-wildfire (Filse Spazio — M.A.R.S. Wildfire).
# Reads the service-role/secret key from a FILE (never an arg or interactive
# read), so the secret never lands in shell history, argv, or a transcript.
# Validates the key, probes read-only, then seeds. Shreds its temp env file.
#
#   1) put ONLY the key in a file (no quotes, no extra lines):
#        cat > /tmp/srk.txt        # paste key, Enter, then Ctrl-D
#   2) bash scripts/seeds/seed-wildfire-prod.sh /tmp/srk.txt [--reset]
#
# Rotate the key afterwards if it was ever exposed.

set -euo pipefail
umask 077

DIR="$(cd "$(dirname "$0")" && pwd)"
URL="https://xndddfopnlrzkydtnjxo.supabase.co"

KEYFILE="${1:-}"
[ -n "$KEYFILE" ] || { echo "usage: seed-wildfire-prod.sh <keyfile> [--reset]" >&2; exit 64; }
[ -f "$KEYFILE" ] || { echo "keyfile not found: $KEYFILE" >&2; exit 1; }
RESET=""
[ "${2:-}" = "--reset" ] && RESET="true"

# Strip whitespace/newlines a paste or editor may add. Key stays in $KEY only.
KEY="$(tr -d '[:space:]' < "$KEYFILE")"
[ -n "$KEY" ] || { echo "keyfile is empty after trimming whitespace" >&2; exit 1; }

# Validate locally. $KEY passed via env (K=...), so the secret is never a literal
# in this command — only the variable name appears.
K="$KEY" node --input-type=module -e '
const k=process.env.K||"";
if(k.startsWith("sb_secret_")){console.error(`key: new secret (sb_secret_…) len=${k.length} — ok`);process.exit(0);}
if(k.startsWith("sb_publishable_")||k.startsWith("anon")){console.error("key is publishable/anon — need the SECRET key");process.exit(3);}
const p=k.split(".");
if(p.length!==3){console.error(`key is neither sb_secret_ nor a JWT (len=${k.length}) — bad file`);process.exit(2);}
let j; try{j=JSON.parse(Buffer.from(p[1],"base64url").toString("utf8"));}catch(e){console.error("bad JWT payload");process.exit(2);}
console.error(`key: legacy JWT role=${j.role} ref=${j.ref} len=${k.length}`);
if(j.role!=="service_role"){console.error("role is "+(j.role||"?")+", need service_role");process.exit(3);}
if(j.ref!=="xndddfopnlrzkydtnjxo"){console.error("wrong project ref: "+j.ref);process.exit(4);}
'

# Service-account key for Drive doc creation (optional). Defaults to /tmp/sa.json;
# if present, deliverable links become real Google Docs, else placeholder. Only
# the file PATH is recorded (not a secret).
SA_KEYFILE="${GOOGLE_SA_KEYFILE:-/tmp/sa.json}"
if [ -f "$SA_KEYFILE" ]; then
  echo "Drive: SA key $SA_KEYFILE → deliverable links will be real Google Docs" >&2
else
  SA_KEYFILE=""
  echo "Drive: no SA key (looked at /tmp/sa.json) → deliverable links use placeholder" >&2
fi

ENV_FILE="$(mktemp /tmp/.wildfire-env.XXXXXX)"
cleanup(){ shred -u "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"; }
trap cleanup EXIT INT TERM
# All seed config flows through the env file the seed parses directly (bypasses
# rtk/dotenv interference and avoids bash assignment-prefix pitfalls).
{
  printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n' "$URL"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$KEY"
  [ -n "$SA_KEYFILE" ] && printf 'GOOGLE_SA_KEYFILE=%s\n' "$SA_KEYFILE"
  [ -n "$RESET" ] && printf 'SEED_RESET=true\n'
} > "$ENV_FILE"

# Read-only probe: auth works? owner exists? duplicate workspace?
echo "Probing prod (read-only)…" >&2
EF="$ENV_FILE" node --input-type=module -e '
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
const t=readFileSync(process.env.EF,"utf8"); const e={};
for(const l of t.split(/\r?\n/)){const i=l.indexOf("=");if(i>0)e[l.slice(0,i)]=l.slice(i+1);}
const URL=e.NEXT_PUBLIC_SUPABASE_URL, KEY=e.SUPABASE_SERVICE_ROLE_KEY;
const r=await fetch(`${URL}/rest/v1/workspaces?select=id&limit=1`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
const body=(await r.text()).slice(0,200);
console.error(`  REST ${URL} -> HTTP ${r.status}  ${body}`);
if(r.status===401){console.error("PROBE_FAIL: key not valid for this project (wrong project or revoked).");process.exit(10);}
const admin=createClient(URL,KEY,{auth:{persistSession:false}});
let uid=null;
for(let p=1;p<20;p++){const{data,error:er}=await admin.auth.admin.listUsers({page:p,perPage:1000});if(er){console.error("  listUsers ERR:",JSON.stringify(er));process.exit(11);}const u=data.users.find(x=>x.email==="team@innovina.it");if(u){uid=u.id;break;}if(data.users.length<1000)break;}
console.error("  team@innovina.it:",uid||"NOT FOUND");
if(!uid)process.exit(12);
const{data:dup}=await admin.from("workspaces").select("id,name").ilike("name","%Wildfire%");
console.error("  existing Wildfire workspaces:",JSON.stringify(dup||[]));
'

echo "Probe OK. Seeding prod…" >&2
SEED_ENV_FILE="$ENV_FILE" node "$DIR/mars-wildfire.mjs"
