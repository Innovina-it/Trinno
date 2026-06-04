#!/usr/bin/env bash
# Surgical removal of the seeded "Swich — M.A.R.S. Firefighter" workspace from
# PROD. Deletes ONE workspace row by id+name+owner (triple-guard); FK CASCADE
# drops its boards/lists/cards/deliverables/milestones/links/members. Nothing
# else in prod is touched. Reads the key from a FILE (never argv).
#
#   bash scripts/seeds/delete-swich-prod.sh /tmp/srk.txt
#
# Reversible: re-run scripts/seeds/seed-swich-prod.sh to recreate it.

set -euo pipefail
umask 077

URL="https://xndddfopnlrzkydtnjxo.supabase.co"
WS_ID="12c1a1ca-8917-46bf-9738-476a5abfcea9"
WS_NAME="Swich — M.A.R.S. Firefighter"
OWNER_ID="d4ac1d7b-dacc-485a-a448-a724c44626f7"

KEYFILE="${1:-}"
[ -n "$KEYFILE" ] || { echo "usage: delete-swich-prod.sh <keyfile>" >&2; exit 64; }
[ -f "$KEYFILE" ] || { echo "keyfile not found: $KEYFILE" >&2; exit 1; }
KEY="$(tr -d '[:space:]' < "$KEYFILE")"
[ -n "$KEY" ] || { echo "keyfile empty" >&2; exit 1; }

ENV_FILE="$(mktemp /tmp/.swich-del.XXXXXX)"
cleanup(){ shred -u "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"; }
trap cleanup EXIT INT TERM
{
  printf 'URL=%s\n' "$URL"
  printf 'KEY=%s\n' "$KEY"
} > "$ENV_FILE"

EF="$ENV_FILE" WS_ID="$WS_ID" WS_NAME="$WS_NAME" OWNER_ID="$OWNER_ID" \
node --input-type=module -e '
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
const t=readFileSync(process.env.EF,"utf8"); const e={};
for(const l of t.split(/\r?\n/)){const i=l.indexOf("=");if(i>0)e[l.slice(0,i)]=l.slice(i+1);}
const admin=createClient(e.URL,e.KEY,{auth:{persistSession:false}});
const ID=process.env.WS_ID, NAME=process.env.WS_NAME, OWNER=process.env.OWNER_ID;

// 1. Fetch target + verify identity.
const {data:ws,error}=await admin.from("workspaces").select("id,name,owner_id").eq("id",ID).maybeSingle();
if(error){console.error("lookup error:",error.message);process.exit(2);}
if(!ws){console.log("Workspace not found — already gone. Nothing to delete.");process.exit(0);}
if(ws.name!==NAME){console.error(`SAFETY ABORT: name mismatch (found "${ws.name}", expected "${NAME}"). Not deleting.`);process.exit(5);}
if(ws.owner_id!==OWNER){console.error(`SAFETY ABORT: owner mismatch (${ws.owner_id} != ${OWNER}). Not deleting.`);process.exit(5);}

// 2. Count what will cascade (for the record).
const boards=(await admin.from("boards").select("id").eq("workspace_id",ID)).data||[];
const ids=boards.map(b=>b.id);
let cards=0;
if(ids.length){const{count}=await admin.from("cards").select("*",{count:"exact",head:true}).in("board_id",ids);cards=count??0;}
const ms=(await admin.from("milestones").select("*",{count:"exact",head:true}).eq("workspace_id",ID)).count??0;
const lk=(await admin.from("links").select("*",{count:"exact",head:true}).eq("workspace_id",ID)).count??0;
console.log(`Target verified: "${ws.name}" (${ID})`);
console.log(`Will cascade-delete: ${boards.length} boards · ${cards} cards · ${ms} milestones · ${lk} links`);

// 3. Delete — guarded by id + name + owner so only this exact row can go.
const {error:de}=await admin.from("workspaces").delete().eq("id",ID).eq("name",NAME).eq("owner_id",OWNER);
if(de){console.error("DELETE error:",de.message);process.exit(3);}

// 4. Verify gone.
const {data:after}=await admin.from("workspaces").select("id").eq("id",ID).maybeSingle();
if(after){console.error("STILL PRESENT — delete did not take. Check RLS/permissions.");process.exit(4);}
console.log("Deleted OK. Workspace and all its boards/cards/deliverables/milestones/links are gone.");
'
