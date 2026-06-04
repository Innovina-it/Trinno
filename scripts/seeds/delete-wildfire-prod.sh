#!/usr/bin/env bash
# Surgical removal of the seeded "Filse Spazio — M.A.R.S. Wildfire" workspace from
# PROD. Resolves the owner by email, finds the ONE workspace by name+owner,
# verifies name+owner, then deletes by id+name+owner (triple-guard). FK CASCADE
# drops its boards/lists/cards/links/members. Nothing else in prod is touched.
# Reads the key from a FILE (never argv).
#
#   bash scripts/seeds/delete-wildfire-prod.sh /tmp/srk.txt
#
# Reversible: re-run scripts/seeds/seed-wildfire-prod.sh to recreate it.

set -euo pipefail
umask 077

URL="https://xndddfopnlrzkydtnjxo.supabase.co"
WS_NAME="Filse Spazio — M.A.R.S. Wildfire"
OWNER_EMAIL="team@innovina.it"

KEYFILE="${1:-}"
[ -n "$KEYFILE" ] || { echo "usage: delete-wildfire-prod.sh <keyfile>" >&2; exit 64; }
[ -f "$KEYFILE" ] || { echo "keyfile not found: $KEYFILE" >&2; exit 1; }
KEY="$(tr -d '[:space:]' < "$KEYFILE")"
[ -n "$KEY" ] || { echo "keyfile empty" >&2; exit 1; }

ENV_FILE="$(mktemp /tmp/.wildfire-del.XXXXXX)"
cleanup(){ shred -u "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"; }
trap cleanup EXIT INT TERM
{
  printf 'URL=%s\n' "$URL"
  printf 'KEY=%s\n' "$KEY"
} > "$ENV_FILE"

EF="$ENV_FILE" WS_NAME="$WS_NAME" OWNER_EMAIL="$OWNER_EMAIL" \
node --input-type=module -e '
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
const t=readFileSync(process.env.EF,"utf8"); const e={};
for(const l of t.split(/\r?\n/)){const i=l.indexOf("=");if(i>0)e[l.slice(0,i)]=l.slice(i+1);}
const admin=createClient(e.URL,e.KEY,{auth:{persistSession:false}});
const NAME=process.env.WS_NAME, EMAIL=process.env.OWNER_EMAIL;

// Resolve owner by email.
let uid=null;
for(let p=1;p<20;p++){const{data,error:er}=await admin.auth.admin.listUsers({page:p,perPage:1000});if(er){console.error("listUsers ERR:",er.message);process.exit(11);}const u=data.users.find(x=>x.email===EMAIL);if(u){uid=u.id;break;}if(data.users.length<1000)break;}
if(!uid){console.error(`owner ${EMAIL} not found`);process.exit(12);}

// Find the ONE workspace by name+owner.
const {data:rows,error}=await admin.from("workspaces").select("id,name,owner_id").eq("name",NAME).eq("owner_id",uid);
if(error){console.error("lookup error:",error.message);process.exit(2);}
if(!rows||rows.length===0){console.log("Workspace not found — already gone. Nothing to delete.");process.exit(0);}
if(rows.length>1){console.error(`SAFETY ABORT: ${rows.length} workspaces match name+owner. Not deleting.`);process.exit(5);}
const ws=rows[0];
if(ws.name!==NAME){console.error(`SAFETY ABORT: name mismatch (found "${ws.name}").`);process.exit(5);}
if(ws.owner_id!==uid){console.error("SAFETY ABORT: owner mismatch.");process.exit(5);}
const ID=ws.id;

// Count what will cascade.
const boards=(await admin.from("boards").select("id").eq("workspace_id",ID)).data||[];
const ids=boards.map(b=>b.id);
let cards=0;
if(ids.length){const{count}=await admin.from("cards").select("*",{count:"exact",head:true}).in("board_id",ids);cards=count??0;}
const lk=(await admin.from("links").select("*",{count:"exact",head:true}).eq("workspace_id",ID)).count??0;
console.log(`Target verified: "${ws.name}" (${ID})`);
console.log(`Will cascade-delete: ${boards.length} boards · ${cards} cards · ${lk} links`);

// Delete — guarded by id + name + owner.
const {error:de}=await admin.from("workspaces").delete().eq("id",ID).eq("name",NAME).eq("owner_id",uid);
if(de){console.error("DELETE error:",de.message);process.exit(3);}

// Verify gone.
const {data:after}=await admin.from("workspaces").select("id").eq("id",ID).maybeSingle();
if(after){console.error("STILL PRESENT — delete did not take.");process.exit(4);}
console.log("Deleted OK. Workspace and all its boards/cards/deliverables/links are gone.");
'
