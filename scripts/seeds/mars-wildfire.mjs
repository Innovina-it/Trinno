#!/usr/bin/env node
// Filse Spazio — M.A.R.S. Wildfire project-plan seeder (anchor-card + sub-board format).
//
// Source: "azione111ds_156852 — Relazione Tecnica" (FILSE Liguria, Azione 1.1.1
// DS, Space Economy). M.A.R.S. Wildfire = decision-support system fusing
// Copernicus/EFFIS satellite data with real-time drone data (M.A.R.S. Control
// Unit / Sentinel). TRL4 → TRL6. Beneficiary: Inspire S.r.l. (solo) with
// external consultants (Rafla, Invenio Consulting, CNR). The bando is in
// Italian; the seeded board/docs are in English (owner request).
//
// Logical structure (clone of scripts/seeds/swich-mars.mjs, new content):
//   Workspace "Filse Spazio — M.A.R.S. Wildfire"
//   └─ Parent board "Wildfire · Project Plan"  (6 WP anchor cards)
//      └─ 6 sub-boards, one per WP, each linked 1:1 to its anchor card via
//         boards.parent_card_id (migration 0105)
//         └─ each sub-board:
//            ├─ Tx.y task-cards (type=task)          ← the WP's tasks
//            └─ Dx.y deliverable-cards (type=task)   ← the WP's outputs; each
//               carries a yellow URL link (card-scope `links`, migration 0121)
//               → its Google Doc.
//
// Note vs Swich: deliverables here are WP-scoped (not task-scoped) and the WP
// anchor lives on the PARENT board, so deliverables cannot be subtasks of the
// anchor (trigger 0018 requires parent+child co-located on one board). They are
// therefore sibling cards on the sub-board, flagged "Deliverable" in the body.
//
// Dates: calendar months from PROJECT_START. The doc gives absolute WP windows
// (T0 = 12 Jan 2026 → T+18M); the owner's real start is 21 May 2026, so we
// anchor M1 = 21 May 2026 and keep the doc's relative WP offsets. Span 18
// months: monthStart(1) = 21 May 2026, monthStart(19) = 21 Nov 2027. A WP
// "Mx–My" gets start=monthStart(x), target=monthStart(y+1). Deliverables are
// dated at their WP's completion.
//
// Required env
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Optional env
//   SEED_EMAIL       — owner; default "team@innovina.it"
//   SEED_WORKSPACE   — workspace name; default "Filse Spazio — M.A.R.S. Wildfire"
//   SEED_RESET       — "true" wipes existing workspace before re-seeding
//   SEED_ENV_FILE    — path to a one-off env file; bypasses dotenv/rtk interference
//   GOOGLE_SA_KEYFILE — service-account JSON key → real Google Docs per deliverable
//   WILDFIRE_DRIVE_FOLDER_ID — shared Drive folder; default below

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "fs";
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
const WORKSPACE_NAME =
  process.env.SEED_WORKSPACE || "Filse Spazio — M.A.R.S. Wildfire";
const PARENT_BOARD_TITLE = "Wildfire · Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

// Calendar-month dating. M1 = 21 May 2026; monthStart(19) = 21 Nov 2027 (18 mo).
const PROJECT_START = new Date("2026-05-21T09:00:00Z");
const SPAN_MONTHS = 18;
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

const PLACEHOLDER_LINK_COLOR = "#facc15"; // yellow diamond
const PLACEHOLDER_LINK_URL = "https://www.corriere.it";

// --- Google Drive (optional) -----------------------------------------------
// <DRIVE_FOLDER_ID>/<WP title>/<Deliverables>/<deliverable doc>. Find-or-create
// / idempotent (the SA cannot delete in a Shared Drive).
const DRIVE_FOLDER_ID =
  process.env.WILDFIRE_DRIVE_FOLDER_ID || "1wCMs8EIznWsmxWRbTRxc0bTZFqDsqJXv";
const DELIVERABLE_SUBFOLDER =
  process.env.WILDFIRE_DELIVERABLE_SUBFOLDER || "Deliverables";
const SA_KEYFILE = process.env.GOOGLE_SA_KEYFILE;

async function setupDrive() {
  if (!SA_KEYFILE) return null;
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEYFILE,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const folder = await drive.files.get({
    fileId: DRIVE_FOLDER_ID,
    fields: "id,name,driveId",
    supportsAllDrives: true,
  });
  const driveId = folder.data.driveId;
  const esc = (s) => s.replace(/'/g, "\\'");
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const DOC_MIME = "application/vnd.google-apps.document";

  const cache = new Map();
  async function findOrCreate(name, mimeType, parentId) {
    const key = `${parentId} ${name}`;
    if (cache.has(key)) return cache.get(key);
    const q = `name='${esc(name)}' and '${parentId}' in parents and trashed=false`;
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
      const r = await drive.files.create({
        requestBody: { name, mimeType, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id,name,webViewLink",
      });
      res = { ...r.data, created: true };
    }
    cache.set(key, res);
    return res;
  }

  return {
    folderName: folder.data.name,
    // <folder>/<WP title>/<Deliverables>/<doc>
    async docUrlFor(wpName, docName) {
      const wpFolder = await findOrCreate(wpName, FOLDER_MIME, DRIVE_FOLDER_ID);
      const delFolder = await findOrCreate(
        DELIVERABLE_SUBFOLDER,
        FOLDER_MIME,
        wpFolder.id,
      );
      const doc = await findOrCreate(docName, DOC_MIME, delFolder.id);
      return { url: doc.webViewLink, created: doc.created };
    },
  };
}

// ---------------------------------------------------------------------------
// Content — M.A.R.S. Wildfire. 6 WP · 26 tasks · 21 deliverables.

const OBJECTIVES = [
  {
    code: "WP1",
    title: "WP1 — M.A.R.S. Hardware System Adaptation & Development",
    phase: "SS",
    lead: "Inspire S.r.l.",
    external: "Rafla S.r.l.",
    startMonth: 7,
    endMonth: 12,
    description:
      "Full adaptation of the existing M.A.R.S. hardware to wildfire scenarios: turning the platform from a static install into a mobile tactical unit on a pickup, plus a robust, interchangeable sensor payload the platform's robotic arm can swap autonomously. Covers vehicle fit-out, the roll-out (deployment) system, a rugged support trailer, the mechanical payload and the avionics-integration software.",
    tasks: [
      {
        code: "T1.1",
        title: "T1.1 — Design & integration on pickup vehicle",
        description:
          "Dimensional survey of the Ford Ranger bed (used by VVFF / Civil Protection) and the M.A.R.S. base; CAD design of custom flanges and safety locking blocks for fast, secure anchoring with easy release; structural / load analysis for stability on rough terrain; procurement, fabrication and assembly of the mechanical parts.",
      },
      {
        code: "T1.2",
        title: "T1.2 — Roll-out (scarrellamento) & levelling system development",
        description:
          "CAD design of foldable brackets and a piston-based kinematic mechanism (with Rafla's detailed-engineering consultancy); selection/procurement of commercial components (pistons, control unit, hydraulic/electrical connections, ground supports); control-panel development for the lift/lower/level sequence; integration and commissioning on the vehicle.",
      },
      {
        code: "T1.3",
        title: "T1.3 — Safety devices setup",
        description:
          "Analysis of safety regulations for transporting generators and fuel on special vehicles; installation of certified extinguishers, safety signage (heat/fire risk) and forced ventilation on the pickup bed.",
      },
      {
        code: "T1.4",
        title: 'T1.4 — "Rugged" support trailer setup',
        description:
          "Selection of an off-road-homologated tow trailer; design/fabrication of custom housings for the 2nd UAV, the auxiliary fuel tank, mission equipment and extra safety devices; fuel-transfer system (pump, lines, controls) from the auxiliary tank to the M.A.R.S. generator; full-load testing on rough terrain.",
      },
      {
        code: "T1.5",
        title: "T1.5 — Mechanical payload design & development",
        description:
          'CAD design of the custom "M.A.R.S. Payload" enclosure for the selected sensor suite (protection, stability, balance); prototype via 3D printing or CNC; integration of power/data connectors; compatibility test with the platform\'s robotic arm for automatic swap.',
      },
      {
        code: "T1.6",
        title: "T1.6 — Avionics integration software",
        description:
          "Driver software integrating the gimbal and sensors with the drone's flight controller; modules for remote gimbal/sensor control from the M.A.R.S. Control Unit; video streaming and data transmission to the M.A.R.S. platform; platform-side software for receiving, decoding and storing the acquired data.",
      },
    ],
    deliverables: [
      {
        code: "D1.1",
        title: "D1.1 — Complete CAD design of the mounting & roll-out system",
        description:
          "Complete CAD design of the platform mounting and roll-out (scarrellamento) system.",
      },
      {
        code: "D1.2",
        title: "D1.2 — Structural analysis & risk-assessment document",
        description:
          "Structural analysis document and risk assessment for the mobile assembly.",
      },
      {
        code: "D1.3",
        title: "D1.3 — M.A.R.S. platform mounted & tested on Ford Ranger pickup",
        description:
          "M.A.R.S. platform mounted and commissioned on the Ford Ranger pickup.",
      },
      {
        code: "D1.4",
        title: 'D1.4 — "Rugged" support trailer set up & operational',
        description: 'Rugged support trailer fitted out and fully operational.',
      },
      {
        code: "D1.5",
        title: "D1.5 — CAD design & construction drawings of the mechanical payload",
        description:
          "CAD design and construction drawings of the mechanical payload enclosure.",
      },
      {
        code: "D1.6",
        title: "D1.6 — Acquisition payload assembled, integrated & operational",
        description:
          "Acquisition payload assembled, integrated and operational with the platform.",
      },
      {
        code: "D1.7",
        title: "D1.7 — Integration software for sensor data acquisition & transmission",
        description:
          "Integration software for acquisition and transmission of the sensor data.",
      },
    ],
  },

  {
    code: "WP2",
    title: "WP2 — Industrial Research & Design of the M.A.R.S. Control Unit",
    phase: "RI",
    lead: "Inspire S.r.l.",
    external: "Invenio Consulting S.r.l. · CNR",
    startMonth: 1,
    endMonth: 8,
    description:
      "De-risks the WP3 software build through rigorous up-front research and design: end-user workflow (UX) analysis, a robust software architecture, study of the WMS standard for EFFIS/Copernicus data integration, and prototyping of critical components. CNR defines the attack-strategy models.",
    tasks: [
      {
        code: "T2.1",
        title: "T2.1 — Requirements & user-workflow (UX) analysis",
        description:
          'User stories, functional requirements (e.g. "show the 3-hour propagation forecast") and non-functional ones (e.g. "update the front map in under 5 minutes"); operational workflow design; wireframes/mockups for preliminary validation.',
      },
      {
        code: "T2.2",
        title: "T2.2 — Technological & architectural analysis",
        description:
          "In-depth study of the WMS (Web Map Service) protocol used by EFFIS Copernicus (auth, layer query, caching); comparative evaluation of software architectures (microservices vs monolith) and geo-spatial DBs; scouting of open-source (commercial-free) GIS / data-processing / message-queue libraries.",
      },
      {
        code: "T2.3",
        title: "T2.3 — API & model modelling",
        description:
          "API definition for integrating UNIGE's fire-propagation models and CNR's what-if attack-strategy models, which identify where ground/aerial crews should concentrate suppression and predict how an action modifies the fire's subsequent evolution.",
      },
      {
        code: "T2.4",
        title: "T2.4 — Prototyping & technical validation",
        description:
          "Proof-of-concept prototypes for the riskiest tech choices; a working prototype to acquire/visualise/query an EFFIS WMS layer; a geo-spatial DB performance prototype simulating high-frequency UAV data ingestion.",
      },
    ],
    deliverables: [
      {
        code: "D2.1",
        title: "D2.1 — Requirements analysis, functional specs & software architecture",
        description:
          "Requirements analysis, functional specifications and software architecture document.",
      },
      {
        code: "D2.2",
        title: "D2.2 — Open-source technology evaluation report",
        description: "Evaluation report of candidate open-source technologies.",
      },
      {
        code: "D2.3",
        title: "D2.3 — Scientific report on attack-strategy identification modelling",
        description:
          "Scientific report on the modelling of attack-strategy identification (CNR).",
      },
    ],
  },

  {
    code: "WP3",
    title: "WP3 — M.A.R.S. Control Unit Development",
    phase: "SS",
    lead: "Inspire S.r.l.",
    external: "Invenio Consulting S.r.l.",
    startMonth: 10,
    endMonth: 15,
    description:
      "Builds the system's 'brain': a software platform creating a unified, intelligent operational picture via multi-scale data fusion — macro-scale EFFIS/Copernicus context plus micro-scale real-time UAV data — feeding the UNIGE/CNR models for prediction and what-if simulation.",
    tasks: [
      {
        code: "T3.1",
        title: "T3.1 — Backend & data architecture development",
        description:
          "Microservices architecture (Java Spring Boot); EFFIS Copernicus ingestion via WMS (fire-danger maps, burnt-area perimeters, Fire Radiative Power); connector for live M.A.R.S. data (fire-front position); geo-spatial DB (PostgreSQL/PostGIS) for all information layers.",
      },
      {
        code: "T3.2",
        title: "T3.2 — Scientific-models integration",
        description:
          "Service orchestrating the UNIGE model using both live UAV and satellite inputs; logic to run on-demand what-if simulations based on the CNR models.",
      },
      {
        code: "T3.3",
        title: "T3.3 — Frontend & GIS interface development",
        description:
          "Web UI (e.g. Angular); GIS mapping library (e.g. Mapbox, Leaflet, QGIS); display of EFFIS Copernicus layers; real-time display of the UAV-detected fire front; UNIGE forecast layers; what-if interface showing the impact of CNR strategies.",
      },
    ],
    deliverables: [
      {
        code: "D3.1",
        title: "D3.1 — Full source code of the M.A.R.S. Control Unit (Backend & Frontend)",
        description:
          "Complete source code of the M.A.R.S. Control Unit (Backend and Frontend).",
      },
      {
        code: "D3.2",
        title: "D3.2 — M.A.R.S. Control Unit installed & operational (prototype)",
        description:
          "M.A.R.S. Control Unit installed and operational (prototype version).",
      },
      {
        code: "D3.3",
        title: "D3.3 — User & technical manual of the software platform",
        description: "User and technical manual of the software platform.",
      },
    ],
  },

  {
    code: "WP4",
    title: "WP4 — Industrial Research for Mapping & Recognition Algorithms",
    phase: "RI",
    lead: "Inspire S.r.l.",
    external: "Invenio Consulting S.r.l.",
    startMonth: 1,
    endMonth: 8,
    description:
      "Preparatory research for the WP5 edge-computing build: real-time georeferencing from a moving UAV, reliable AI fire recognition, and selection of the optimal sensor suite plus edge platform — so later development rests on solid, verified algorithmic foundations.",
    tasks: [
      {
        code: "T4.1",
        title: "T4.1 — Study of georeferencing methodologies",
        description:
          "Literature review of photogrammetry and sensor-fusion techniques (GPS-RTK, IMU, gimbal angles) for real-time orthorectification of UAV imagery; distortion correction and accurate geometric projection onto a DTM/DEM.",
      },
      {
        code: "T4.2",
        title: "T4.2 — Study of fire-recognition models",
        description:
          "State-of-the-art Computer Vision / AI (CNNs, semantic-segmentation networks) on thermal and multispectral imagery; focus on models that reliably discriminate fire from other heat sources via spectral information.",
      },
      {
        code: "T4.3",
        title: "T4.3 — Algorithmic prototyping & validation",
        description:
          "Software prototypes of the most promising algorithms (Python, OpenCV, TensorFlow/PyTorch); fire-image datasets; performance tests for accuracy and processing speed.",
      },
      {
        code: "T4.4",
        title: "T4.4 — Edge-computing platform analysis & selection",
        description:
          "Market and comparative analysis of embedded compute platforms (NVIDIA Jetson, Google Coral, Raspberry Pi Compute Module) for on-UAV AI, by compute (TOPS), power, weight, size, interfaces and cost; selection of the platform for WP5.",
      },
      {
        code: "T4.5",
        title: "T4.5 — Market analysis & sensor technology selection",
        description:
          "Market analysis of radiometric thermal cameras and 3-axis gimbals; evaluation of adding a wide-spectrum (multi/hyperspectral) camera to read the heat source's spectral signature; comparative study (weight, size, resolution, interfaces, cost); shortlist of sensor candidates for the test phase.",
      },
    ],
    deliverables: [
      {
        code: "D4.1",
        title: "D4.1 — Technical report on UAV georeferencing methodologies",
        description: "Technical report on georeferencing methodologies for UAVs.",
      },
      {
        code: "D4.2",
        title: "D4.2 — Technical report on AI models for fire recognition",
        description: "Technical report on AI models for fire recognition.",
      },
      {
        code: "D4.3",
        title: "D4.3 — Comparative analysis & tech selection (sensors + edge-computing)",
        description:
          "Comparative analysis and technology selection of the sensors and the edge-computing platform.",
      },
    ],
  },

  {
    code: "WP5",
    title: "WP5 — Edge-Computing Software for Fire-Front Mapping",
    phase: "SS",
    lead: "Inspire S.r.l.",
    external: "Invenio Consulting S.r.l.",
    startMonth: 10,
    endMonth: 15,
    description:
      "Moves intelligence to the edge (on-drone): instead of streaming heavy raw thermal video over limited bandwidth, an embedded computer (e.g. NVIDIA Jetson) recognises the fire and georeferences each front point in real time, emitting lightweight geospatial data and a WMS feed to the Control Unit.",
    tasks: [
      {
        code: "T5.1",
        title: "T5.1 — Input data acquisition & processing",
        description:
          "Software for synchronised capture of the thermal video stream and telemetry (GPS-RTK, drone IMU, gimbal angles); filtering and correction of raw data to improve reliability.",
      },
      {
        code: "T5.2",
        title: "T5.2 — Fire recognition & mapping",
        description:
          "Computer-vision algorithms (e.g. CNNs) to process thermal images and isolate fire pixels vs false positives; geometric-projection algorithms mapping fire pixels from image coordinates to ground coordinates (real-time orthorectification).",
      },
      {
        code: "T5.3",
        title: "T5.3 — Data optimization & transmission",
        description:
          "Code optimisation (e.g. CUDA on NVIDIA GPU) for real-time execution on the embedded board; extension of the data protocol to send georeferenced information to the M.A.R.S. platform.",
      },
      {
        code: "T5.4",
        title: "T5.4 — WMS server development on the M.A.R.S. platform",
        description:
          "Module aggregating fire-front points into a lightweight standard format (e.g. GeoJSON); WMS (Web Map Service) server on the M.A.R.S. platform exposing the front map interoperably to the Control Unit.",
      },
    ],
    deliverables: [
      {
        code: "D5.1",
        title: "D5.1 — Edge-computing mapping software running on the selected EDGE board",
        description:
          "Edge-computing mapping software installed and operational on the selected EDGE board.",
      },
      {
        code: "D5.2",
        title: "D5.2 — WMS service publishing the fire-front map, live on the M.A.R.S. platform",
        description:
          "WMS service for publishing the fire-front map, live on the M.A.R.S. platform.",
      },
    ],
  },

  {
    code: "WP6",
    title: "WP6 — Definition & Execution of the TRL6 Validation Test",
    phase: "SS",
    lead: "Inspire S.r.l.",
    external: null,
    startMonth: 13,
    endMonth: 18,
    description:
      "Validates the whole end-to-end system to demonstrate TRL6: a realistic test scenario (with Civil Protection) exercising mobile deployment, continuous front mapping and the Control Unit's prediction — proving the EFFIS/Copernicus strategic context is correctly enriched by high-precision real-time drone data. Final gate before proposing an operational pilot.",
    tasks: [
      {
        code: "T6.1",
        title: "T6.1 — Test protocol definition",
        description:
          "With UNIGE and Civil Protection, define a simulated wildfire scenario (controlled fires / safe heat sources in an authorised area); success metrics / KPIs (front georeferencing < 1 m, map update < 5 min, propagation-forecast deviation vs reality); test-plan document with procedures, safety measures and roles.",
      },
      {
        code: "T6.2",
        title: "T6.2 — Test preparation & coordination",
        description:
          "Identify and prepare the private test site; logistics with all partners and competent authorities (Fire Brigade, Civil Protection) together with UNIGE and CNR; setup of all instrumentation (Pickup, MARS, UAV, M.A.R.S. Control Unit).",
      },
      {
        code: "T6.3",
        title: "T6.3 — Field test execution",
        description:
          "Deploy the MARS system in the operational area; run continuous surveillance missions over the simulated fire; acquire and record all system-generated data (logs, maps, video, software performance).",
      },
      {
        code: "T6.4",
        title: "T6.4 — Results analysis & validation",
        description:
          "Analyse the collected data and compute the KPIs defined in the protocol; validate the system's fusion of field data with real-time EFFIS Copernicus weather and fire-risk data for the test area; final test report with results and improvement areas.",
      },
    ],
    deliverables: [
      {
        code: "D6.1",
        title: "D6.1 — Approved test-plan document",
        description: "Approved test-plan document.",
      },
      {
        code: "D6.2",
        title: "D6.2 — Photo & video report of the test execution",
        description: "Photographic and video report of the test execution.",
      },
      {
        code: "D6.3",
        title: "D6.3 — Complete dataset of logs & data collected during the test",
        description: "Complete dataset of logs and data collected during the test.",
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
    `Span: M1 ${monthDateStr(1)} → end ${monthDateStr(SPAN_MONTHS + 1)} (${SPAN_MONTHS} months)`,
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
      `Drive: docs in "${drive.folderName}"/<WP>/${DELIVERABLE_SUBFOLDER}/`,
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

  let taskCount = 0;
  let delCount = 0;
  let linkCount = 0;
  let docCreated = 0;
  let docReused = 0;

  positionCounter = 0;
  for (const wp of OBJECTIVES) {
    const ext = wp.external ? ` · Subcontractor: ${wp.external}` : "";

    // 1. WP anchor card on the parent board.
    const [anchorCard] = await call("cards", {
      list_id: parentTodoList,
      board_id: parentBoard.id,
      title: wp.title,
      position: nextPos(),
      type: "task",
      owner_id: null,
      description:
        `**Work Package (WP)** · ${kindLabel(wp.phase)} · Lead ${wp.lead}${ext} · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
      start_date: monthDateStr(wp.startMonth),
      target_date: monthDateStr(wp.endMonth + 1),
    });

    // 2. Sub-board anchored 1:1 to that card.
    const [subBoard] = await call("boards", {
      workspace_id: ws.id,
      parent_board_id: parentBoard.id,
      parent_card_id: anchorCard.id,
      title: wp.title,
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

    // 3. Task cards in the sub-board (dated within the WP window).
    for (const t of wp.tasks) {
      await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: t.title,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description: `**Task** · ${wp.code} · ${wp.lead}\n\n${t.description}`,
        start_date: monthDateStr(wp.startMonth),
        target_date: monthDateStr(wp.endMonth + 1),
      });
      taskCount += 1;
    }

    // 4. Deliverable cards in the sub-board (dated at WP completion), each with
    //    a yellow link → its Google Doc (or the placeholder).
    for (const d of wp.deliverables) {
      const [delCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: d.title,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description: `**Deliverable** · ${wp.code} · ${wp.lead}\n\n${d.description}`,
        start_date: monthDateStr(wp.endMonth),
        target_date: monthDateStr(wp.endMonth + 1),
      });
      delCount += 1;

      let linkUrl = PLACEHOLDER_LINK_URL;
      if (drive) {
        const doc = await drive.docUrlFor(wp.title, d.title);
        linkUrl = doc.url;
        if (doc.created) docCreated += 1;
        else docReused += 1;
      }

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

    console.log(
      `  ${wp.code}: anchor ${anchorCard.id}, sub-board ${subBoard.id}, ${wp.tasks.length} tasks · ${wp.deliverables.length} deliverables`,
    );
  }

  console.log("");
  const linkNote = drive
    ? `${linkCount} Drive-doc links (${docCreated} created, ${docReused} reused)`
    : `${linkCount} placeholder links`;
  console.log(
    `Done. ${OBJECTIVES.length} WP · ${taskCount} tasks · ${delCount} deliverables (${linkNote}).`,
  );
  console.log(`Open <your-domain>/w/${ws.id} — login as ${SEED_EMAIL}.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
