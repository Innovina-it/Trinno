#!/usr/bin/env node
// Swich — M.A.R.S. Firefighter project-plan seeder (anchor-card + sub-board format).
//
// Source: "Swich — WP e Piano di Progetto" (Piano di Dettaglio del Progetto,
// Criterio E.1 Allegato 5 al Bando). Firefighting-UAV programme with in-flight
// recharge. Project span: M1 = 16 Jan 2026 → end = 16 Jul 2028 (30 months).
// The bando is in Italian; the seeded board/docs are in English (owner request).
//
// Logical structure (decided with the owner):
//   Workspace "Swich — M.A.R.S. Firefighter"
//   └─ Parent board "Swich · Project Plan"  (5 OR anchor cards + 8 plan milestones)
//      └─ 5 sub-boards, one per OR (work objective), each linked 1:1 to
//         its anchor card via boards.parent_card_id (migration 0105)
//         └─ each sub-board:
//            ├─ WPx.y task-cards (type=task)          ← the work packages, dates from the WP text
//            └─ Dx.y.z deliverable-cards (type=subtask) ← children of the most-related WP,
//               dated at their reporting milestone. Each carries a yellow URL
//               link (card-scope `links` row, migration 0121) → its Google Doc.
//
// Why this shape (same machinery as scripts/seeds/aiwepi.mjs — a DIFFERENT
// project — but new content):
//   - Sub-boards under a parent (migration 0099 — boards.parent_board_id).
//   - Each sub-board anchored 1:1 to a card on the parent board via
//     boards.parent_card_id (migration 0105). The roadmap's groupBySubBoard
//     builds lanes from this anchor → sub-board mapping.
//   - workspaces.feature_flags set so sub-board / shared-cache flags are ON.
//   - Plan milestones live in the milestones table (migration 0095) anchored to
//     the parent board so they pin on the master roadmap (mirrors the PDF's
//     milestone/deliverable master table).
//   - lists.status_kind set on INSERT. owner_id set on INSERT (never UPDATE —
//     migration 0081 trigger blocks owner_id UPDATE by service-role JWTs).
//   - Every project-plan card is UNASSIGNED (owner_id = null, no card_members
//     row). SEED_EMAIL is the workspace owner + board admin so they see the
//     workspace, but cards are unowned: the plan behaves like a template the
//     team self-assigns from. "Mine" empty, "All" = every card.
//   - All cards land in Todo. The roadmap/Gantt is driven by start/target
//     dates, not list placement, so the plan reads correctly while the kanban
//     starts clean.
//
// Dates: calendar months (not 30-day approximations) so the span lands exactly
// on the bando's 16 Jan 2026 → 16 Jul 2028. monthStart(1) = 16 Jan 2026,
// monthStart(31) = 16 Jul 2028. A WP "Mx–My" gets start=monthStart(x),
// target=monthStart(y+1) (covers through the end of month y). Deliverables are
// dated at their reporting milestone (their producing WP may finish earlier —
// faithful to R&D practice where the formal artefact lands at the review gate).
//
// Source note: the OR table gives OR5 as M24–M30, but every OR5 work package
// states M16–M30 in its own text. We keep the OR5 anchor at the OR-table dates
// (M24–M30) and each WP at its stated dates (M16–M30). The source is internally
// inconsistent here; we encode it faithfully rather than reconcile it.
//
// Required env
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Optional env
//   SEED_EMAIL      — owner; default "team@innovina.it"
//   SEED_WORKSPACE  — workspace name; default "Swich — M.A.R.S. Firefighter"
//   SEED_RESET      — "true" wipes existing workspace before re-seeding
//   SEED_ENV_FILE   — path to a one-off env file; bypasses dotenv/rtk interference
//                     (used by ./scripts/seeds/run.sh)
//
// Run via ./scripts/seeds/run.sh — it handles env discovery, sensitive-flag
// prompts, and safety guards.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { spawnSync } from "child_process";
import { createReadStream, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.SEED_ENV_FILE) {
  const text = readFileSync(process.env.SEED_ENV_FILE, "utf8");
  let injected = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    injected += 1;
  }
  console.log(`Loaded ${injected} env keys from ${process.env.SEED_ENV_FILE}`);
} else {
  config({ path: join(__dirname, "..", "..", ".env.local") });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service)
  throw new Error(
    "missing supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
  );

const admin = createClient(url, service, { auth: { persistSession: false } });

const SEED_EMAIL = process.env.SEED_EMAIL || "team@innovina.it";
const WORKSPACE_NAME = process.env.SEED_WORKSPACE || "Swich — M.A.R.S. Firefighter";
const PARENT_BOARD_TITLE = "Swich · Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

// Calendar-month dating. M1 = 16 Jan 2026; monthStart(31) = 16 Jul 2028.
const PROJECT_START = new Date("2026-01-16T09:00:00Z");
const monthStart = (m) => {
  const d = new Date(PROJECT_START);
  d.setUTCMonth(d.getUTCMonth() + (m - 1));
  return d;
};
const monthDateStr = (m) => monthStart(m).toISOString().slice(0, 10);

const WORKSPACE_FEATURE_FLAGS = {
  subboards_enabled: true,
  shared_workspace_cache_v2: true,
  virtualized_board: false,
  lazy_card_history: false,
};

const DEFAULT_LISTS = [
  { title: "Todo", statusKind: "todo" },
  { title: "In Progress", statusKind: "in_progress" },
  { title: "Done", statusKind: "done" },
];

const kindLabel = (k) =>
  k === "RI" ? "Industrial Research (RI)" : "Experimental Development (SS)";

// Short responsible-org tag appended to each WP task title (e.g. " - BE-ST").
const ownerTag = (o) => (o || "").replace(/\s*S\.r\.l\.?/g, "").trim();

// Per-deliverable URL link (card-scope `links` row, migration 0121). Rendered as
// a coloured diamond on the card. Yellow = "Giallo" = LINK_COLORS[0] in
// lib/links/colors.ts (also the default). One link per deliverable card (DB
// enforces a unique card-scope link per card).
const PLACEHOLDER_LINK_COLOR = "#facc15";
// Fallback link when no Google service account is configured.
const PLACEHOLDER_LINK_URL = "https://www.corriere.it";

// --- Google Drive (optional) -----------------------------------------------
// When GOOGLE_SA_KEYFILE points at a service-account JSON key, the seed creates
// (or reuses) one empty Google Doc per deliverable and links each deliverable
// card to that doc instead of the placeholder. Drive layout:
//   <DRIVE_FOLDER_ID>/<OR title>/<Deliverables>/<deliverable doc>
// The SA must be a member of the (Shared Drive) folder with create rights. It is
// find-or-create / idempotent because the SA cannot delete files: re-seeding
// reuses the same folders/docs (stable URLs) rather than duplicating them.
const DRIVE_FOLDER_ID =
  process.env.SWICH_DRIVE_FOLDER_ID || "1iysVHSw6qtnpsCNLswV-mB_sq9hS3eZK";
const DELIVERABLE_SUBFOLDER =
  process.env.SWICH_DELIVERABLE_SUBFOLDER || "Deliverables";
const SA_KEYFILE = process.env.GOOGLE_SA_KEYFILE;
// Each deliverable doc starts from the project .docx template (same skeleton as
// the ARISE template, with Swich's header), gets its [DOCUMENT TITLE] and
// [Document subtitle] placeholders filled inside the .docx, and is uploaded via
// Drive with conversion to a native Google Doc. Drive API only — no Docs API.
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_DOCX = join(__dirname, "templates", "swich.docx");

// Fill the title placeholders inside the .docx (a zip) before upload — the same
// zipfile surgery as build-templates.py. Both placeholders are contiguous
// strings in word/document.xml (verified against templates/swich.docx).
const PATCH_DOCX_PY = `
import sys, zipfile
from xml.sax.saxutils import escape
src, dst, title, subtitle = sys.argv[1:5]
zin = zipfile.ZipFile(src)
zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == "word/document.xml":
        xml = data.decode("utf-8")
        xml = xml.replace("[DOCUMENT TITLE]", escape(title))
        xml = xml.replace("[Document subtitle]", escape(subtitle))
        data = xml.encode("utf-8")
    zout.writestr(item, data)
zout.close()
`;

let patchSeq = 0;
function patchDocxTemplate(title, subtitle) {
  const out = join(tmpdir(), `seed-docx-${process.pid}-${++patchSeq}.docx`);
  const r = spawnSync("python3", [
    "-c",
    PATCH_DOCX_PY,
    TEMPLATE_DOCX,
    out,
    title,
    subtitle,
  ]);
  if (r.status !== 0) {
    throw new Error(
      `docx patch failed for "${title}": ${r.stderr?.toString().trim() || r.error?.message}`,
    );
  }
  return out;
}

async function setupDrive() {
  if (!SA_KEYFILE) return null;
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEYFILE,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  // Resolve the (Shared) Drive id from the parent folder so file listing can be
  // scoped correctly. Undefined for a personal My-Drive folder.
  const folder = await drive.files.get({
    fileId: DRIVE_FOLDER_ID,
    fields: "id,name,driveId",
    supportsAllDrives: true,
  });
  const driveId = folder.data.driveId;
  const esc = (s) => s.replace(/'/g, "\\'");
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const DOC_MIME = "application/vnd.google-apps.document";

  // Cache folder/doc lookups by `${parentId} ${name}` so the OR and
  // Deliverables folders are resolved once and reused across deliverables in
  // the same OR (one create, not one per doc).
  const cache = new Map();
  async function findOrCreate(name, mimeType, parentId, makeDocx) {
    const key = `${parentId} ${name}`;
    if (cache.has(key)) return cache.get(key);
    // mimeType filter: leftover .docx uploads from before native-Doc conversion
    // must not be reused — a fresh native Doc is created next to them instead.
    const q = `name='${esc(name)}' and '${parentId}' in parents and mimeType='${mimeType}' and trashed=false`;
    const list = await drive.files.list({
      q,
      fields: "files(id,name,webViewLink)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(driveId ? { corpora: "drive", driveId } : {}),
    });
    const hit = list.data.files?.[0];
    let res;
    if (hit) {
      res = { ...hit, created: false };
    } else {
      const args = {
        requestBody: { name, mimeType, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id,name,webViewLink",
      };
      // Deliverable docs upload a per-doc patched copy of the template (title
      // filled); requestBody.mimeType is the native Doc mime, so Drive converts
      // on upload (no .DOCX badge). makeDocx runs lazily — only when creating.
      const tmpDocx = makeDocx ? makeDocx() : null;
      if (tmpDocx) {
        args.media = { mimeType: DOCX_MIME, body: createReadStream(tmpDocx) };
      }
      try {
        const r = await drive.files.create(args);
        res = { ...r.data, created: true };
      } finally {
        if (tmpDocx) unlinkSync(tmpDocx);
      }
    }
    cache.set(key, res);
    return res;
  }

  return {
    folderName: folder.data.name,
    // <folder>/<OR title>/<Deliverables>/<doc>  — each doc is a native Google
    // Doc converted from the project template (scripts/seeds/templates/swich.docx),
    // with [DOCUMENT TITLE]/[Document subtitle] filled in the .docx pre-upload.
    async docUrlFor(orName, docName, meta = {}) {
      const orFolder = await findOrCreate(orName, FOLDER_MIME, DRIVE_FOLDER_ID);
      const delFolder = await findOrCreate(
        DELIVERABLE_SUBFOLDER,
        FOLDER_MIME,
        orFolder.id,
      );
      const subtitle =
        [meta.lead, meta.milestone].filter(Boolean).join(" · ") || orName;
      const doc = await findOrCreate(docName, DOC_MIME, delFolder.id, () =>
        patchDocxTemplate(docName, subtitle),
      );
      return { url: doc.webViewLink, created: doc.created };
    },
  };
}

// ---------------------------------------------------------------------------
// Content — Swich / M.A.R.S. Firefighter. 5 OR, 25 WP, 8 milestones, 22 deliverables.
// Deliverables are embedded on the most topically-related WP; each carries the
// reporting milestone it belongs to (per the PDF's milestone→deliverable tables).

const OBJECTIVES = [
  {
    code: "OR1",
    title:
      "OR1 — Recharge-system pre-design and software control requirements definition",
    leader: "Inspire S.r.l.",
    cost: "€ 599.817,46",
    startMonth: 1,
    endMonth: 15,
    personMonths: "Inspire 10.3 · BE-ST 17.9 · POLITO 21.6",
    description:
      "Pre-design of the in-flight recharge system and definition of the software control requirements, integrating Inspire's technology with current firefighting methodologies. Includes a comparative study and regulatory analysis against traditional means, definition of the technical and functional requirements for in-flight recharge and UAV-Container coupling, design of the mechatronic solutions for transporting and releasing the extinguishing liquid, and flight dynamics modelling. By the end, the requirements for the subsequent implementation phases are defined.",
    workPackages: [
      {
        code: "WP1.1",
        title:
          "WP1.1 — Comparative study of Inspire's technology versus traditional wildfire-fighting technologies",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 1,
        endMonth: 3,
        consulting: "Innovina Consulting S.r.l.",
        description:
          "Comparative study between Inspire's technology and traditional aerial wildfire-fighting means. Drafting of a state-of-the-art report with a European/global mapping of technologies, a comparative study via a dedicated simulator (reaction times, monitoring accuracy, predictive capability, operating costs), interactions with Civil Protection and the Fire Brigade, and analysis of regulatory requirements and operational standards. Output: a synthesis document of the strengths plus a comparative simulator as a decision-support tool.",
      },
      {
        code: "WP1.2",
        title:
          "WP1.2 — Analysis of the technical, functional and regulatory requirements of the in-flight recharge system and the UAV-Container coupling",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 3,
        endMonth: 6,
        consulting: "Innovina Consulting S.r.l.",
        description:
          "Analysis of the technical, functional and regulatory requirements for in-flight recharge and UAV-Container coupling. Covers the valve system (flow rate, fluid compatibility), regulations for UAVs with take-off weight over 100 kg, the mechanical coupling interface, guidance sensors (proximity, GPS, computer vision), vehicle centring, and definition of the interface architecture with the communication and control layer.",
        deliverables: [
          {
            code: "D1.1.1",
            title: "D1.1.1 — Technical Requirements Report: Flight System",
            milestone: "M1.1",
            milestoneMonth: 6,
            description:
              "Technical report detailing the technical requirements for the flight system (six-monthly cadence M6/M12).",
          },
          {
            code: "D1.2.3",
            title: "D1.2.3 — Requirements Report: Coupling Control System",
            milestone: "M1.2",
            milestoneMonth: 15,
            description:
              "Document specifying the requirements for controlling the coupling process between the UAV and the recharge station.",
          },
        ],
      },
      {
        code: "WP1.3",
        title:
          "WP1.3 — Comparative study of mechatronic solutions for transporting and releasing the extinguishing liquid",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 1,
        endMonth: 3,
        consulting: "Innovina Consulting S.r.l.",
        description:
          "Comparison of mechatronic solutions for transporting and releasing the extinguishing liquid, focused on the 'bucket' subsystem. Two key aspects: the mechanical constraint and coupling to the UAV platform (able to withstand the liquid's weight and aerodynamic forces, with quick assembly/disassembly) and a fast, reliable and controlled water-release mechanism that avoids the 'reclosing' problem.",
      },
      {
        code: "WP1.4",
        title:
          "WP1.4 — Analysis of the hardware and firmware requirements of the extinguishing-liquid release system",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 3,
        endMonth: 6,
        consulting: "Innovina Consulting S.r.l.",
        description:
          "Analysis of the hardware and firmware requirements for a precise and timely release of the extinguishing liquid. Component selection starting from the mechatronic hardware of WP1.3, evaluation of sensors (flow, pressure, temperature, humidity), design of a control interface for real-time management and monitoring with smooth communication to the M.A.R.S. platform, and analysis of the communication components with the UAV system.",
      },
      {
        code: "WP1.5",
        title:
          "WP1.5 — Analysis of the ground-platform requirements for ground recharge",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 3,
        endMonth: 6,
        consulting: "Innovina Consulting S.r.l.",
        description:
          "Analysis of the requirements of the ground system for recharging the drones with extinguishing liquid and fuel. Examination of the requirements (flow rates and pump specifications), optimisation of the recharge system (size, configuration, transportability and manoeuvrability in emergencies) and analysis of the regulatory and safety requirements to ensure reliability and operational compliance.",
        deliverables: [
          {
            code: "D1.1.2",
            title: "D1.1.2 — Technical Requirements Report: Ground System",
            milestone: "M1.1",
            milestoneMonth: 6,
            description:
              "Document describing the specific technical requirements for the ground recharge system.",
          },
        ],
      },
      {
        code: "WP1.6",
        title: "WP1.6 — Design and sensorisation of the basket",
        kind: "RI",
        partner: "POLITO",
        startMonth: 1,
        endMonth: 15,
        description:
          "Study of the basket configuration: architecture of the internal tanks, method of connection to the drone and preliminary structural sizing for weight estimation. Compartmentalisation of the volume of the two tanks (fuel for the propellers and extinguishing liquid) to reduce the shift of the centre of gravity during rapid ejection, and design of the sensor network for monitoring the automatic filling/emptying phases. Functional to building the 'bucket' prototype in OR2.",
        deliverables: [
          {
            code: "D1.1.3",
            title:
              "D1.1.3 — Technology Report: Basket Design and Sensorisation (PoLiTo)",
            milestone: "M1.1",
            milestoneMonth: 6,
            description:
              "Report on the structural architecture of the basket and the sensor network needed to monitor automatic emptying/filling of the tanks.",
          },
        ],
      },
      {
        code: "WP1.7",
        title:
          "WP1.7 — Analysis of the requirements for the real-time release point and UAV interface",
        kind: "RI",
        partner: "BE-ST S.r.l.",
        startMonth: 3,
        endMonth: 6,
        consulting: "Rafla S.r.l.",
        description:
          "Analysis of the requirements to determine, in real time, the optimal release point of the liquid via AI algorithms. Development of an automatic targeting system that analyses data from the drone's sensors and cameras, a smooth communication interface between UAV navigation and the release command, requirements for real-time video capture (image quality and frame rate), and a preliminary design of the AI processing/analysis architecture compatible with the UAVs' weight, power consumption and interfaces.",
        deliverables: [
          {
            code: "D1.2.2",
            title: "D1.2.2 — Requirements Report: In-Flight Control System",
            milestone: "M1.2",
            milestoneMonth: 15,
            description:
              "Report defining the technical and functional requirements needed for the control system during flight.",
          },
        ],
      },
      {
        code: "WP1.8",
        title:
          "WP1.8 — Testdeck creation through acquisition of simulated-fire video",
        kind: "RI",
        partner: "BE-ST S.r.l.",
        startMonth: 1,
        endMonth: 6,
        consulting: "Rafla S.r.l.",
        description:
          "Creation of a test station for acquiring and analysing simulated-fire video, designed together with Inspire (propagation speed, environmental conditions, scenic variables). Acquisition and collection of a test deck of surveillance imagery for training the neural networks, with documentation of methodologies and results. Includes the purchase of development-environment licences and workstations sized for the activity.",
        deliverables: [
          {
            code: "D1.2.1",
            title: "D1.2.1 — Testdeck Report",
            milestone: "M1.2",
            milestoneMonth: 15,
            description:
              "Report summarising the results of the tests and trials carried out on the system, focusing on validation of the interfaces and functionalities.",
          },
        ],
      },
      {
        code: "WP1.9",
        title:
          "WP1.9 — Software sizing and identification of the suitable electronic platform (BE-ST)",
        kind: "RI",
        partner: "BE-ST S.r.l.",
        startMonth: 6,
        endMonth: 15,
        consulting: "Rafla S.r.l.",
        description:
          "Definition of the technical specifications for the electronic platform that manages the data-release system, starting from the analyses of WP1.7 and WP1.8. Exploration of telecommunication solutions for a continuous and reliable data flow between M.A.R.S. and the remote system, selection of high-performance processing units, and definition of the integration with the UAV system (GIMBAL, environmental sensors). Includes the purchase of processing boards compatible with the UAV architecture.",
      },
    ],
    milestones: [
      {
        code: "M1.1",
        name: "M1.1 — Full-System Pre-Design Complete",
        month: 6,
        description:
          "Completion of the pre-design phase of the complete system (bucket, flange, ground station). Deliverables: D1.1.1, D1.1.2, D1.1.3.",
      },
      {
        code: "M1.2",
        name: "M1.2 — Control-System Pre-Design Complete",
        month: 15,
        description:
          "Completion of the control-system pre-design, essential for safe integration and operation. Deliverables: D1.2.1, D1.2.2, D1.2.3.",
      },
    ],
  },

  {
    code: "OR2",
    title:
      "OR2 — Design, development and control of the UAV system for extinguishant release",
    leader: "BE-ST S.r.l.",
    cost: "€ 908.602,81",
    startMonth: 7,
    endMonth: 30,
    personMonths: "Inspire 20.5 · BE-ST 8.3 · POLITO 21.6 · UNIGE 0",
    description:
      "Design, development and control of a UAV system for releasing extinguishant, including flight control, targeting and integration with the ground systems. Includes dynamic modelling of the trajectory with a suspended basket, building the hydraulic subsystem and the bucket with a fast-release mechanism, fire-front recognition and optimised-release algorithms, and positioning sensors with a flight-control software interface. Output: an integrated and optimised release system, high-performing and safe in critical scenarios.",
    workPackages: [
      {
        code: "WP2.1",
        title: "WP2.1 — Flight dynamics modelling study",
        kind: "RI",
        partner: "POLITO",
        startMonth: 16,
        endMonth: 30,
        description:
          "Lumped-parameter model of the dynamics of a drone with a suspended basket holding a rapidly-ejected liquid. Addresses the large suspended mass, rapid emptying, liquid sloshing (modelled with Volume of Fluid codes for multiphase fluids, then turned into surrogate models) and thermal turbulence. Verifies whether the attitude control stabilises the oscillations of the drone + basket assembly; from this the requirements for the preliminary basket design are derived.",
        deliverables: [
          {
            code: "D2.1.1",
            title: "D2.1.1 — Technology Report: Flight Dynamics Model (PoLiTo)",
            milestone: "M2.1",
            milestoneMonth: 18,
            description:
              "Report on the lumped-parameter dynamics model developed and on the basket design.",
          },
        ],
      },
      {
        code: "WP2.2",
        title: "WP2.2 — Design and construction of the bucket subsystem",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 13,
        endMonth: 18,
        description:
          "Design and construction of the bucket subsystem for the UAV, based on the OR1 requirements (WP1.1–WP1.4). Mechanical constraint system for stable coupling, fast water-release mechanism with automatic reset, on-board electronics for recharge/release control, level sensors, hydraulic control and energy management. In parallel with WP3.1 and linked to WP3.2. Includes material costs for the prototype (steel, electronic components).",
        deliverables: [
          {
            code: "D2.1.2",
            title:
              "D2.1.2 — Design Document: Hydraulic Subsystem with Prototype",
            milestone: "M2.1",
            milestoneMonth: 18,
            description:
              "Technical report outlining the specifications and progress of the hydraulic subsystem, with prototype.",
          },
          {
            code: "D2.1.3",
            title:
              "D2.1.3 — Design Document: Complete Bucket System with Prototype",
            milestone: "M2.1",
            milestoneMonth: 18,
            description:
              "Detailed deliverable highlighting the final features of the release system (bucket), with prototype.",
          },
        ],
      },
      {
        code: "WP2.3",
        title:
          "WP2.3 — Development of algorithms for fire-front recognition, flight steering and extinguishing-liquid release control",
        kind: "SS",
        partner: "BE-ST S.r.l.",
        startMonth: 16,
        endMonth: 27,
        description:
          "Development of advanced algorithms based on the requirements of WP1.7–WP1.9: computer vision and machine learning for real-time recognition of the fire front from thermal cameras and on-board sensors, flight planning and steering algorithms towards the TARGET (considering propagation speed and wind direction), and release-control algorithms that compute the optimal moment (distance, altitude, weather). Deployment on real UAV platforms with experimental testing; associated Cloud services foreseen.",
      },
      {
        code: "WP2.4",
        title:
          "WP2.4 — Design and implementation of positioning and guidance sensors and development of the flight-control software interface",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 22,
        endMonth: 27,
        description:
          "Integration of advanced sensors (cameras, GPS/RTK/GLONASS) for UAV positioning, downstream of the WP2.2 prototype. Development of a software interface for real-time management and coordination of the release (in collaboration with BE-ST regarding WP2.3), with automatic target tracking. Prototype with mechanical, electrical and electronic components, and housings that minimise electromagnetic interference and vibration. Includes costs for sensors, antennas and IT tools.",
        deliverables: [
          {
            code: "D2.2.1",
            title: "D2.2.1 — Flight-Control System Mockup",
            milestone: "M2.2",
            milestoneMonth: 27,
            description:
              "Visual and functional representation of the flight-control system, useful for validating functionalities and identifying improvements.",
          },
        ],
      },
    ],
    milestones: [
      {
        code: "M2.1",
        name: "M2.1 — Bucket System Built",
        month: 18,
        description:
          "Design and development of the extinguishant-release system (bucket), effective and reliable for firefighting operations. Deliverables: D2.1.1, D2.1.2, D2.1.3.",
      },
      {
        code: "M2.2",
        name: "M2.2 — Flight-Control System Development Complete",
        month: 27,
        description:
          "Completion of the flight-control system development, for UAV manoeuvrability and precision during release. Deliverable: D2.2.1.",
      },
    ],
  },

  {
    code: "OR3",
    title: "OR3 — Design and development of the ground recharge system",
    leader: "Inspire S.r.l.",
    cost: "€ 743.266,10",
    startMonth: 1,
    endMonth: 24,
    personMonths: "Inspire 12.6 · POLITO 0 · CNR 12.2 · UNIGE 12.5",
    description:
      "Design, construction and integration of the electronic and sensor components for the UAV and for the ground recharge system, closely connected to OR2. Includes design of the station's hydraulic/mechanical/electronic components (tanks, coupling interfaces, industrial automation), the hardware/software system for UAV-platform communications, algorithms for efficient refuelling of multiple drones, and resource-demand forecasting. Output: a fully integrated and optimised ground recharge system.",
    workPackages: [
      {
        code: "WP3.1",
        title:
          "WP3.1 — Design and construction of the ground recharge station subsystems and automation subsystems",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 13,
        endMonth: 18,
        description:
          "Design and construction of the subsystems for the ground recharge station (starting from the WP1.5 requirements): hydraulic/mechanical/electronic components, integrated tanks with level monitoring and flow control, automatic coupling/decoupling interfaces, high-performance recharge and a communication protocol with the UAV. Industrial-automation subsystem (sensors, actuators, automatic roof opening/closing, component elevation). Includes material costs (container, metal/electronic materials, sensors, valves).",
        deliverables: [
          {
            code: "D3.2.2",
            title:
              "D3.2.2 — Design Document: Automation Systems Synthesis",
            milestone: "M3.2",
            milestoneMonth: 24,
            description:
              "Complete synthesis of the automation systems integrated into the ground recharge station.",
          },
        ],
      },
      {
        code: "WP3.2",
        title:
          "WP3.2 — Design and development of the interface and management software for UAV-Container coupling",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 19,
        endMonth: 24,
        description:
          "Development of the UAV-Container coupling management software integrated with the WP3.1 hardware. Control system for automatic docking with sensors for precise position detection (LIDAR, cameras, proximity) and actuators for fine movement adjustment, and a bidirectional UAV-platform communication interface for exchanging information during approach, coupling and decoupling. Includes costs for IT tools supporting interface development.",
        deliverables: [
          {
            code: "D3.2.3",
            title:
              "D3.2.3 — Design Document: Complete Ground System with Prototype",
            milestone: "M3.2",
            milestoneMonth: 24,
            description:
              "Final design of the ground recharge station, with a functional prototype demonstrating the integration of the various components.",
          },
        ],
      },
      {
        code: "WP3.3",
        title:
          "WP3.3 — Development of optimisation algorithms for refuelling management",
        kind: "RI",
        partner: "CNR",
        startMonth: 1,
        endMonth: 15,
        description:
          "Optimisation of aerial refuelling operations for drone fleets via the M.A.R.S. platform, addressing queue management with multiple aircraft in flight (single- or multi-platform scenarios). Literature review, mathematical models for optimal scheduling, and exact and heuristic algorithms in a prototype software environment. Results crucial for sizing the bucket (WP2.2) and the ground recharge station (WP3.1, WP3.2).",
        deliverables: [
          {
            code: "D3.1.1",
            title:
              "D3.1.1 — Mathematical Analysis and Modelling of the Optimisation Problem and Related Algorithms for Refuelling Management (CNR)",
            milestone: "M3.1",
            milestoneMonth: 15,
            description:
              "Technical report with a detailed analysis of the mathematical techniques used to optimise refuelling management.",
          },
          {
            code: "D3.1.2",
            title:
              "D3.1.2 — Refuelling Management: Definition of Test Scenarios for Validating the Optimisation Algorithms and Discussion of Numerical Results (CNR)",
            milestone: "M3.1",
            milestoneMonth: 15,
            description:
              "Technical report with the test scenarios for validating the optimisation algorithms and discussion of the numerical results obtained.",
          },
        ],
      },
      {
        code: "WP3.4",
        title:
          "WP3.4 — Data acquisition and resource-demand forecasting for the M.A.R.S. platform",
        kind: "RI",
        partner: "UNIGE",
        startMonth: 1,
        endMonth: 15,
        description:
          "Advanced monitoring system for the operational continuity of the M.A.R.S. firefighting drones, with constant checking of the water and fuel level in the container. Two phases: data acquisition from the sensors (consumption per mission, residual quantity, environmental parameters) and processing with a future-consumption forecasting algorithm able to adapt to mission profiles and weather conditions. Closely linked to WP2.2, WP3.1 and WP3.2.",
        deliverables: [
          {
            code: "D3.2.1",
            title:
              "D3.2.1 — Water and Fuel Demand Forecasting Algorithm, Based on Operational Data and External Conditions (Unige)",
            milestone: "M3.2",
            milestoneMonth: 24,
            description:
              "Algorithm that forecasts resource demand, adapting to variables such as increased mission frequency and weather conditions.",
          },
        ],
      },
      {
        code: "WP3.5",
        title: "WP3.5 — Design and construction of the hydraulic subsystem",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 7,
        endMonth: 12,
        description:
          "Design and construction of the hydraulic subsystem, the core around which the bucket and ground station are developed (it precedes WP2.2, WP3.1, WP3.2). Includes the Staubli flange (integrated on both the bucket and the recharge station) for fast and safe connection, tanks sized for UAV and ground, and a recharge plant for the ground tanks with monitoring and control. Includes material costs for the prototype (steel, metal hardware, electronic components, valves).",
      },
    ],
    milestones: [
      {
        code: "M3.1",
        name: "M3.1 — Optimisation Algorithms Development Complete",
        month: 15,
        description:
          "End of the development of the optimisation algorithms for refuelling management. Deliverables: D3.1.1, D3.1.2.",
      },
      {
        code: "M3.2",
        name: "M3.2 — Ground Station Construction Complete",
        month: 24,
        description:
          "End of design and construction of the ground recharge station, with integration of electronic, mechanical and sensor components. Deliverables: D3.2.1, D3.2.2, D3.2.3.",
      },
    ],
  },

  {
    code: "OR4",
    title:
      "OR4 — Development and optimisation of the control and operational-management algorithms",
    leader: "Inspire S.r.l.",
    cost: "€ 371.733,95",
    startMonth: 16,
    endMonth: 30,
    personMonths: "Inspire 6.8 · CNR 11.2 · UNIGE 12.5",
    description:
      "Development and optimisation of the control and operational-management algorithms for coordination between the UAV and the ground station, including logistics with multiple UAVs. Equips the prototypes with a 'first-of-its-kind' level of automation: firmware for flight control, approach and refuelling; an optimised container-refuelling planning model; and algorithms plus a decision-support system for optimal positioning of the platforms relative to the fire front.",
    workPackages: [
      {
        code: "WP4.1",
        title: "WP4.1 — Development of the firmware for flight control and refuelling",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 16,
        endMonth: 20,
        description:
          "Advanced firmware for UAV flight control and refuelling, interwoven with WP2.3, WP2.4 and WP3.2. Covers flight control (stability and precision in variable conditions), approach (automated orientation and positioning protocols), automatic in-flight refuelling (computing optimal positioning and timing) and automation of critical manoeuvres to reduce human intervention. Includes material costs (antennas, modems, UAV components, electronics, IT tools) and prototype.",
        deliverables: [
          {
            code: "D4.1.1",
            title: "D4.1.1 — Flight-Control Firmware Definition Report",
            milestone: "M4.1",
            milestoneMonth: 30,
            description:
              "Technical report summarising the specifications and functionalities of the firmware developed.",
          },
        ],
      },
      {
        code: "WP4.2",
        title:
          "WP4.2 — Optimised refuelling planning for the M.A.R.S. platform",
        kind: "RI",
        partner: "UNIGE",
        startMonth: 16,
        endMonth: 30,
        description:
          "Efficient management of water and fuel refuelling for M.A.R.S., starting from the WP3.3 results. Optimised planning model that considers the distance of supply sources, vehicle travel times and actual resource consumption; it optimises the time windows by triggering requests in advance and manages the priorities between water and fuel to avoid run-outs during operations.",
        deliverables: [
          {
            code: "D4.1.2",
            title:
              "D4.1.2 — Optimised Planning Model for Water and Fuel Refuelling (Unige)",
            milestone: "M4.1",
            milestoneMonth: 30,
            description:
              "Model that optimises refuelling operations taking the logistical variables into account.",
          },
        ],
      },
      {
        code: "WP4.3",
        title:
          "WP4.3 — Optimal positioning of the M.A.R.S. platforms for UAV refuelling",
        kind: "RI",
        partner: "CNR",
        startMonth: 16,
        endMonth: 30,
        description:
          "Strategic and optimal positioning of one or more M.A.R.S. refuelling platforms relative to the fire front, to ensure the system's coverage. Literature review, analysis of the critical factors (terrain conformation, accessibility, weather, propagation dynamics, costs), definition of the optimisation architecture with evaluation metrics, exact and heuristic algorithms, and creation of test scenarios and a decision-support system for rapid deployment.",
        deliverables: [
          {
            code: "D4.1.3",
            title:
              "D4.1.3 — Mathematical Analysis and Modelling of the Optimisation Problem and Related Algorithms for Platform Positioning (CNR)",
            milestone: "M4.1",
            milestoneMonth: 30,
            description:
              "In-depth study of the optimisation problems of positioning the refuelling platforms, including the necessary algorithms.",
          },
          {
            code: "D4.1.4",
            title:
              "D4.1.4 — Platform Position: Definition of Test Scenarios for Validating the Optimisation Algorithms and Discussion of Numerical Results (CNR)",
            milestone: "M4.1",
            milestoneMonth: 30,
            description:
              "Document with the test scenarios developed to validate the optimisation algorithms for platform positioning.",
          },
        ],
      },
    ],
    milestones: [
      {
        code: "M4.1",
        name:
          "M4.1 — Flight-Control and Refuelling Firmware Development Complete",
        month: 30,
        description:
          "Completion of the firmware development for flight control and refuelling, with automation and optimisation of operations. Deliverables: D4.1.1, D4.1.2, D4.1.3, D4.1.4.",
      },
    ],
  },

  {
    code: "OR5",
    title: "OR5 — Testing, optimisation and validation of the prototype",
    leader: "Inspire S.r.l.",
    cost: "€ 296.292,90",
    startMonth: 24,
    endMonth: 30,
    personMonths: "Inspire 6.8 · BE-ST 6.4",
    description:
      "Final work objective: testing, optimisation and validation of the prototype to reach TRL6 qualification. Construction of the drone support structures and completion of the wiring, definition and execution of test scenarios that simulate real conditions (refuelling + water release on a simulated fire in a safe environment) and verification of the release system. By the end, the Inspire prototype demonstrates efficiency and functionality in suppression operations, qualified at TRL6.",
    workPackages: [
      {
        code: "WP5.1",
        title:
          "WP5.1 — Construction of the UAV supports, mounting of the developed devices, system wiring",
        kind: "SS",
        partner: "BE-ST S.r.l.",
        startMonth: 16,
        endMonth: 30,
        description:
          "Construction of the support structures for the drones (stability and safety in flight, access for maintenance), installation of the devices developed in the project (sensors, communication systems) to optimise their performance, and completion of the wiring of the whole system, interconnecting the devices with the control and monitoring units. Includes material costs (electronic components, steel) and prototype.",
        deliverables: [
          {
            code: "D5.1.1",
            title: "D5.1.1 — Complete-System Assembly Report",
            milestone: "M5.1",
            milestoneMonth: 30,
            description:
              "Technical report documenting the assembly process of the complete system.",
          },
        ],
      },
      {
        code: "WP5.2",
        title: "WP5.2 — Definition of the test scenario for TRL6 qualification of the prototype",
        kind: "RI",
        partner: "Inspire S.r.l.",
        startMonth: 16,
        endMonth: 30,
        description:
          "Identification and development of a test scenario that realistically simulates operational conditions to validate the integration and operation of the subsystems and reach TRL6 qualification. Includes costs for software licences to define/track the scenarios, archive the measurements and catalogue the collected digital material.",
        deliverables: [
          {
            code: "D5.1.2",
            title: "D5.1.2 — Test-Scenario Definition Report",
            milestone: "M5.1",
            milestoneMonth: 30,
            description:
              "Report outlining the specific test scenario for TRL6 qualification, with the parameters and conditions under which the prototype will be tested.",
          },
        ],
      },
      {
        code: "WP5.3",
        title:
          "WP5.3 — Fire-suppression test: pitstop and release on a fire in a safe environment for TRL6 qualification",
        kind: "SS",
        partner: "Inspire S.r.l.",
        startMonth: 16,
        endMonth: 30,
        description:
          "Experimental tests in which the UAVs perform refuelling operations (pitstop) and release the water load onto a simulated fire, in a controlled and safe environment, to reach TRL6 qualification. Sessions with real-time monitoring of flight parameters, operational performance and release effectiveness, followed by in-depth data analysis (response times, release accuracy, overall effectiveness).",
        deliverables: [
          {
            code: "D5.1.3",
            title:
              "D5.1.3 — Final Report on Testing Results Analysis and TRL6 Validation of the Prototype",
            milestone: "M5.1",
            milestoneMonth: 30,
            description:
              "Concluding report analysing the results of the tests carried out and verifying the prototype's validation at TRL6, with an overall assessment of the system's performance.",
          },
        ],
      },
      {
        code: "WP5.4",
        title:
          "WP5.4 — Test of the release system on flames in a scenario decoupled from refuelling",
        kind: "SS",
        partner: "BE-ST S.r.l.",
        startMonth: 16,
        endMonth: 30,
        description:
          "Evaluation and testing of the water-release system, focusing on the functionality and effectiveness of the bucket's opening mechanism, in a test context separate from refuelling. Bench tests (activation time, flow rate, distribution), suppression simulations in controlled environments (integrated with WP5.3) and analysis of the results (response time, release precision, effectiveness). Includes costs for running the mechanical and electronic tests needed for TRL6 validation.",
      },
    ],
    milestones: [
      {
        code: "M5.1",
        name: "M5.1 — Prototype Qualified at TRL 6",
        month: 30,
        description:
          "Qualification of the UAV-support system prototype at TRL6 level, with testing and validation in controlled scenarios. Deliverables: D5.1.1, D5.1.2, D5.1.3.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Supabase helpers — direct table inserts via the service-role admin client.

async function call(table, body) {
  const { data, error } = await admin.from(table).insert(body).select();
  if (error)
    throw new Error(
      `INSERT ${table}: ${error.message} :: ${JSON.stringify(body).slice(0, 240)}`,
    );
  return data;
}

async function findUser(email) {
  const perPage = 1000;
  for (let page = 1; page < 100; page++) {
    const { data: list, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const u = list.users.find((x) => x.email === email);
    if (u) return u.id;
    if (list.users.length < perPage) break;
  }
  throw new Error(
    `No user with email "${email}". Create the account first or set SEED_EMAIL to an existing user.`,
  );
}

async function findWorkspaceByName(name, ownerId) {
  const { data } = await admin
    .from("workspaces")
    .select("id, feature_flags")
    .eq("name", name)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data;
}

async function deleteWorkspace(workspaceId) {
  // FK CASCADE drops boards / lists / cards / milestones / board_members.
  const { error } = await admin
    .from("workspaces")
    .delete()
    .eq("id", workspaceId);
  if (error) throw error;
  console.log(`Deleted workspace ${workspaceId}`);
}

let positionCounter = 0;
function nextPos() {
  positionCounter += 1;
  return `a${String(positionCounter).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------

async function seed() {
  const userId = await findUser(SEED_EMAIL);
  console.log(`Seeding as user ${SEED_EMAIL} (${userId})`);
  console.log(
    `Span: M1 ${monthDateStr(1)} → end ${monthDateStr(31)} (30 months)`,
  );

  let existing = await findWorkspaceByName(WORKSPACE_NAME, userId);
  if (existing && SEED_RESET) {
    await deleteWorkspace(existing.id);
    existing = null;
  }
  if (existing) {
    console.log(
      `Workspace "${WORKSPACE_NAME}" already exists (${existing.id}). Set SEED_RESET=true to wipe and re-seed.`,
    );
    return;
  }

  // Optional Google Drive — resolve up front so a misconfigured folder/SA fails
  // before any Supabase write (no half-seeded workspace on a Drive error).
  const drive = await setupDrive();
  if (drive) {
    console.log(
      `Drive: docs in "${drive.folderName}"/<OR>/${DELIVERABLE_SUBFOLDER}/`,
    );
  } else {
    console.log(
      "Drive: GOOGLE_SA_KEYFILE not set → deliverable links use the placeholder URL",
    );
  }

  // Workspace + feature_flags + membership ---------------------------------
  const [ws] = await call("workspaces", {
    name: WORKSPACE_NAME,
    owner_id: userId,
    feature_flags: WORKSPACE_FEATURE_FLAGS,
  });
  await call("workspace_members", {
    workspace_id: ws.id,
    user_id: userId,
    role: "owner",
  });
  console.log(`Workspace ${WORKSPACE_NAME}: ${ws.id}`);

  // Parent board ----------------------------------------------------------
  const [parentBoard] = await call("boards", {
    workspace_id: ws.id,
    title: PARENT_BOARD_TITLE,
    visibility: "workspace",
    created_by: userId,
  });
  await call("board_members", {
    board_id: parentBoard.id,
    user_id: userId,
    role: "admin",
  });
  console.log(`Parent board: ${parentBoard.id} (${PARENT_BOARD_TITLE})`);

  const parentLists = {};
  for (const [i, l] of DEFAULT_LISTS.entries()) {
    const [row] = await call("lists", {
      board_id: parentBoard.id,
      title: l.title,
      position: `a${String(i + 1).padStart(6, "0")}`,
      status_kind: l.statusKind,
    });
    parentLists[l.statusKind] = row.id;
  }
  const parentTodoList = parentLists.todo;

  const allMilestones = [];
  let wpCount = 0;
  let delCount = 0;
  let linkCount = 0;
  let docCreated = 0;
  let docReused = 0;

  positionCounter = 0;
  for (const or of OBJECTIVES) {
    // 1. OR anchor card on the parent board.
    const [anchorCard] = await call("cards", {
      list_id: parentTodoList,
      board_id: parentBoard.id,
      title: or.title,
      position: nextPos(),
      type: "task",
      owner_id: null,
      description:
        `**Work Objective (OR)** · Leader ${or.leader} · ${or.cost} · M${or.startMonth}–M${or.endMonth}\n` +
        `Person-months: ${or.personMonths}\n\n${or.description}`,
      start_date: monthDateStr(or.startMonth),
      target_date: monthDateStr(or.endMonth + 1),
    });

    // 2. Sub-board anchored 1:1 to that card.
    const [subBoard] = await call("boards", {
      workspace_id: ws.id,
      parent_board_id: parentBoard.id,
      parent_card_id: anchorCard.id,
      title: or.title,
      visibility: "workspace",
      created_by: userId,
    });
    await call("board_members", {
      board_id: subBoard.id,
      user_id: userId,
      role: "admin",
    });

    const subLists = {};
    for (const [i, l] of DEFAULT_LISTS.entries()) {
      const [row] = await call("lists", {
        board_id: subBoard.id,
        title: l.title,
        position: `a${String(i + 1).padStart(6, "0")}`,
        status_kind: l.statusKind,
      });
      subLists[l.statusKind] = row.id;
    }
    const subTodoList = subLists.todo;

    // 3. WP task cards in the sub-board (dates from the WP text).
    for (const wp of or.workPackages) {
      const consult = wp.consulting ? ` · Subcontractor: ${wp.consulting}` : "";
      const [wpCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: `${wp.title} - ${ownerTag(wp.partner)}`,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description:
          `**${kindLabel(wp.kind)}** · ${wp.partner} · M${wp.startMonth}–M${wp.endMonth}${consult}\n\n${wp.description}`,
        start_date: monthDateStr(wp.startMonth),
        target_date: monthDateStr(wp.endMonth + 1),
      });
      wpCount += 1;

      // 4. Deliverable subtasks parented to this WP, dated at their milestone.
      for (const d of wp.deliverables ?? []) {
        const [delCard] = await call("cards", {
          list_id: subTodoList,
          board_id: subBoard.id,
          title: d.title,
          position: nextPos(),
          type: "subtask",
          owner_id: null,
          parent_card_id: wpCard.id,
          description: `**Deliverable** · ${wp.partner} · ${d.milestone} (M${d.milestoneMonth})\n\n${d.description}`,
          start_date: monthDateStr(d.milestoneMonth),
          target_date: monthDateStr(d.milestoneMonth + 1),
        });
        delCount += 1;

        // Link URL: a real Google Doc (created/reused under <OR>/Deliverables/)
        // when a service account is configured, else the placeholder. The doc
        // is named after the deliverable title (e.g. "D1.1.1 — …").
        let linkUrl = PLACEHOLDER_LINK_URL;
        if (drive) {
          const doc = await drive.docUrlFor(or.title, d.title, {
            lead: wp.partner,
            milestone: d.milestone,
          });
          linkUrl = doc.url;
          if (doc.created) docCreated += 1;
          else docReused += 1;
        }

        // Card-scope link (yellow diamond). workspace_id is re-derived from the
        // card's board by the links_set_workspace_id trigger (mig 0121); we pass
        // ws.id only to satisfy NOT NULL.
        await call("links", {
          scope: "card",
          workspace_id: ws.id,
          card_id: delCard.id,
          url: linkUrl,
          color: PLACEHOLDER_LINK_COLOR,
          created_by: userId,
        });
        linkCount += 1;
      }
    }

    // Collect this OR's milestones (pinned to the parent board below).
    for (const m of or.milestones) allMilestones.push(m);

    console.log(
      `  ${or.code}: anchor ${anchorCard.id}, sub-board ${subBoard.id}, ${or.workPackages.length} WP`,
    );
  }

  // Plan milestones (date pins on the master roadmap) ----------------------
  for (const m of allMilestones) {
    await call("milestones", {
      workspace_id: ws.id,
      board_id: parentBoard.id,
      name: m.name,
      date: monthStart(m.month + 1).toISOString(),
      description: m.description,
      created_by: userId,
    });
  }

  console.log("");
  const linkNote = drive
    ? `${linkCount} Drive-doc links (${docCreated} created, ${docReused} reused)`
    : `${linkCount} placeholder links`;
  console.log(
    `Done. ${OBJECTIVES.length} OR · ${wpCount} WP · ${delCount} deliverables (${linkNote}) · ${allMilestones.length} milestones.`,
  );
  console.log(`Open <your-domain>/w/${ws.id} — login as ${SEED_EMAIL}.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
