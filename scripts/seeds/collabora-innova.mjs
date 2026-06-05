#!/usr/bin/env node
// C&I — M.A.R.S. Firefighter project-plan seeder (anchor-card + sub-board format).
//
// Stream: "Collabora & Innova" (C&I), Regione Lombardia FESR 2021-2027, Azione
// 1.1.3. Project: M.A.R.S. Firefighter (Inspire's firefighting UAV with in-flight
// recharge). Partners: Inspire (lead) · Rafla · Synesthesia · Università di Pavia.
// Bando is Italian; seeded board/docs are English (owner request).
//
// Timeline: 27 months, M1 = 13 Oct 2025 → M27 = Dec 2027 (boss-confirmed).
//
// Structure (per boss feedback 2026-06-05):
//   Workspace "C&I — M.A.R.S. Firefighter"
//   └─ Parent board "C&I · Project Plan" (2 phase anchor cards + 6 milestones)
//      └─ 2 sub-boards = the two phases (Ricerca Industriale / Sviluppo Sperimentale)
//         └─ per Azione: a TASK card (type=task, title suffixed with " - <owner>")
//            └─ a DELIVERABLE subtask (type=subtask) — lasts 15 working days and
//               ends on the task's finish date; carries the yellow link → its
//               Google Doc (header generated via Docs API).
//   - roadmap_order is set sequentially so the board reads RI 1..16, SS 1..12.
//
// Drive: <DRIVE_FOLDER_ID>/<phase>/<action title>/<deliverable doc>  (one folder
// per action). Each doc is created empty and filled with a generated header via
// the Docs API — no external template. Needs the Google Docs API enabled + SA in
// scopes drive+documents.
//
// Dates: calendar months. monthStart(1) = 13 Oct 2025; monthStart(28) = 13 Jan 2028.
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: SEED_EMAIL, SEED_WORKSPACE, SEED_RESET, SEED_ENV_FILE,
//   GOOGLE_SA_KEYFILE, CI_DRIVE_FOLDER_ID

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createReadStream, readFileSync } from "fs";
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
  process.env.SEED_WORKSPACE || "C&I — M.A.R.S. Firefighter";
const PARENT_BOARD_TITLE = "C&I · Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

// Calendar months. M1 = 13 Oct 2025; monthStart(28) = 13 Jan 2028 (27-month span).
const PROJECT_START = new Date("2025-10-13T09:00:00Z");
const SPAN_MONTHS = 27;
const monthStart = (m) => {
  const d = new Date(PROJECT_START);
  d.setUTCMonth(d.getUTCMonth() + (m - 1));
  return d;
};
const monthDateStr = (m) => monthStart(m).toISOString().slice(0, 10);

// Subtract N working days (skip Sat/Sun) from a YYYY-MM-DD date.
const minusWorkingDays = (dateStr, n) => {
  const d = new Date(dateStr + "T09:00:00Z");
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
};

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

const PLACEHOLDER_LINK_COLOR = "#facc15"; // yellow diamond
const PLACEHOLDER_LINK_URL = "https://www.corriere.it";

// Short owner tag appended to each task title (e.g. " - Synesthesia").
const ownerTag = (o) =>
  o.replace(/\s*S\.r\.l\./g, "").replace("Università di Pavia", "UniPV").trim();

// --- Google Drive (optional) -----------------------------------------------
// <DRIVE_FOLDER_ID>/<phase>/<action title>/<deliverable doc>. Each deliverable doc
// is a copy of the project .docx template (same skeleton as the ARISE template,
// with C&I's header) — uploaded via the Drive API; no Docs API needed.
const DRIVE_FOLDER_ID =
  process.env.CI_DRIVE_FOLDER_ID || "1oWwzEpJrfsmng-vUMVaRAZnNA9T-K3aF";
const SA_KEYFILE = process.env.GOOGLE_SA_KEYFILE;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_DOCX = join(__dirname, "templates", "ci.docx");

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
  // Folders are created normally; deliverable docs are created by uploading the
  // project .docx template (one copy per deliverable) — pure Drive API, exact
  // ARISE skeleton with C&I's header, no Docs API.
  async function findOrCreate(name, mimeType, parentId, tplDocx) {
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
      const args = {
        requestBody: { name, mimeType, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id,name,webViewLink",
      };
      if (tplDocx) {
        args.media = { mimeType: DOCX_MIME, body: createReadStream(tplDocx) };
      }
      const r = await drive.files.create(args);
      res = { ...r.data, created: true };
    }
    cache.set(key, res);
    return res;
  }

  return {
    folderName: folder.data.name,
    // <folder>/<phase>/<action folder>/<deliverable doc>  — each doc is a copy of
    // the project template (scripts/seeds/templates/ci.docx).
    async docUrlFor(phaseName, actionFolder, docName) {
      const phaseF = await findOrCreate(phaseName, FOLDER_MIME, DRIVE_FOLDER_ID);
      const actF = await findOrCreate(actionFolder, FOLDER_MIME, phaseF.id);
      const doc = await findOrCreate(docName, DOCX_MIME, actF.id, TEMPLATE_DOCX);
      return { url: doc.webViewLink, created: doc.created };
    },
  };
}

// ---------------------------------------------------------------------------
// Content — C&I / M.A.R.S. Firefighter. 2 phases · 28 actions · 6 milestones.
// Each action → a task + a deliverable. RI feeds M+4/+9/+12, SS feeds M+18/+24/+27.

const PHASES = [
  {
    code: "RI",
    title: "Ricerca Industriale (RI)",
    startMonth: 1,
    endMonth: 12,
    description:
      "Industrial Research phase (M1–M12): requirements, subsystem design and prototyping across avionics/flight software (Synesthesia), helicopter mechanics & safety (Rafla), structural research & additive manufacturing (UniPV) and the patented refuelling system & hangar (Inspire). Milestones M1 (M+4), M2 (M+9), M3 (M+12).",
    actions: [
      { code: "RI 1", title: "RI 1 — System Analysis & Flight-Software Architecture Definition", owner: "Synesthesia S.r.l.", milestoneMonth: 4, description: "In-depth requirements study and definition of the overall autonomous-flight software architecture, including interfaces with external systems: operational constraints and integration specs, preliminary architecture of the flight-control and mission-management system, and avionics requirements including on-board sensors and their communication protocols." },
      { code: "RI 2", title: "RI 2 — Autonomous Flight System Design — Avionics & Control", owner: "Synesthesia S.r.l.", milestoneMonth: 9, description: "Detailed design of the avionics and control-system architecture: hardware/software architecture, software modules, sensor interfaces/protocols, sensor selection, ground-communication system and navigation software; technical documentation including wiring schematics for the flight controller, sensors and actuators." },
      { code: "RI 3", title: "RI 3 — Flight Firmware, Simulator & Mission-Control SW Development", owner: "Synesthesia S.r.l.", milestoneMonth: 9, description: "Implementation of the UAV autonomous-control system: software architecture and modules, inter-subsystem interfaces/protocols, a simulation environment to test control logic, flight-control and mission-management algorithms, and external-system interfaces; includes coordinated bucket control and hangar interaction (take-off, landing, refuelling)." },
      { code: "RI 4", title: "RI 4 — Avionics & Control System Prototyping & Testing", owner: "Synesthesia S.r.l.", milestoneMonth: 12, description: "Procurement and validation of the avionics prototypes including on-board sensors: hardware prototypes of custom components, sensor purchase, control-logic validation in simulation, hardware-in-the-loop (HITL) avionics tests and electrical tests; development and validation of calibration and tuning procedures." },
      { code: "RI 5", title: "RI 5 — Preliminary Flight Tests", owner: "Synesthesia S.r.l. + Rafla S.r.l.", milestoneMonth: 12, description: "Install the prototypes on the helicopter for preliminary flight tests: ground tests to validate actuators and verify the installation, then constrained-helicopter flight tests in a controlled environment for verification and an initial tuning of the control software." },
      { code: "RI 6", title: "RI 6 — Helicopter Mechanical Modifications Analysis", owner: "Rafla S.r.l.", milestoneMonth: 4, description: "Study of the mechanical and interface requirements: regulations, technical/functional requirements, selection of the most suitable helicopter model (Robinson R22), preliminary analysis of actuations and mechanical interfaces with the bucket, recharge system and hangar; ends with the helicopter purchase and acquisition of its technical documentation." },
      { code: "RI 7", title: "RI 7 — Autonomous Flight System Design — Mechanics", owner: "Rafla S.r.l.", milestoneMonth: 9, description: "Detailed design of the hardware modifications to make the helicopter autonomous: selection/sizing of flight-command actuators, mechanical interfaces for automation and avionics integration, mass distribution and weight optimisation for the payload, and the mechanical bucket-coupling systems." },
      { code: "RI 8", title: "RI 8 — Unmanned-Helicopter Safety Systems Design (FTS)", owner: "Rafla S.r.l.", milestoneMonth: 9, description: "Design of the hardware/software safety systems per regulation: the Flight Termination System (FTS) board, intervention logic and ground-risk-mitigation system, emergency/fail-safe procedures, continuous monitoring of critical flight parameters, and degraded-control logic. Rafla owns the FTS hardware design and the ground-risk mitigation." },
      { code: "RI 9", title: "RI 9 — Prototyping & Testing of Mechanical Components & Safety Systems", owner: "Rafla S.r.l.", milestoneMonth: 12, description: "Procurement and prototyping of the mechanical components for actuator integration, avionics/sensor housing and bucket anchoring; functional tests to validate performance against requirements; prototyping and bench testing of the safety systems." },
      { code: "RI 10", title: "RI 10 — Subsystems Study, Specs & Topology Optimisation", owner: "Università di Pavia", milestoneMonth: 4, description: "Study, analysis and definition of the specs, architecture and requirements of the research subsystems (the bucket and the bucket↔UAV coupling/connection), focused on topology optimisation of the components with the most critical weight/strength ratio, using ANSYS 2024 R2 / ABAQUS 2024 and ad-hoc open-source tools." },
      { code: "RI 11", title: "RI 11 — Subsystems Design — Structural FEM Analysis", owner: "Università di Pavia", milestoneMonth: 9, description: "Design of the subsystems via finite-element (FEM) structural analysis of the most stressed components, using ANSYS 2024 R2 / ABAQUS 2024 (structural) and COMSOL / ANSYS FLUENT (liquid transport), plus open-source MLPH and OpenFOAM where a commercial library is not adequate." },
      { code: "RI 12", title: "RI 12 — Subsystems Build & Test via Additive Manufacturing", owner: "Università di Pavia", milestoneMonth: 12, description: "Build and test of the subsystems via additive manufacturing in UniPV's labs, with tests on both material samples and the prototypes produced during this phase." },
      { code: "RI 13", title: "RI 13 — Hangar System Analysis & Architecture Definition", owner: "Inspire S.r.l.", milestoneMonth: 4, description: "System analysis and architecture of the Hangar (ground system): the patented temporary-coupling refuelling system; UAV housing/take-off/landing with the required mechanical movements; the hydraulic plant (pumps, tanks, valves); and a PLC-based industrial automation control with an interface to the mission-control system." },
      { code: "RI 14", title: "RI 14 — Patented Refuelling System Design (Platform + Bucket)", owner: "Inspire S.r.l.", milestoneMonth: 9, description: "Design of the patented refuelling system (Platform + Bucket) as a scale-up of the existing TRL5 prototype: the UAV-mounted bucket rechargeable in <30 s with >100 L; the coupling flange with intake/vapour-recovery valves; the bucket-to-ground mechanical coupling; the 'instant' liquid-release mechanism with reset; and the pumps and pressurised hydraulic circuit." },
      { code: "RI 15", title: "RI 15 — Hangar Mechanical Design & Automation", owner: "Inspire S.r.l.", milestoneMonth: 12, description: "Mechanical design and automation of the Hangar (20 ft container): the refuelling system, tanks, UAV stowage during transport, the roof-opening and UAV deploy/recovery mechanisms via an automated lift, and all mechanical movements within the container's constrained space." },
      { code: "RI 16", title: "RI 16 — Refuelling System Prototype Build & Validation", owner: "Inspire S.r.l.", milestoneMonth: 12, description: "Build and validation of the refuelling-system prototype (with UniPV): the airborne component (bucket) that recharges at the platform and releases the water; additive-manufactured structural parts plus valves/mechanics; lab tests using a crane to simulate the UAV (mechanical coupling, refuelling rate >300 L/min, release capability, overall weight)." },
    ],
  },
  {
    code: "SS",
    title: "Sviluppo Sperimentale (SS)",
    startMonth: 13,
    endMonth: 27,
    description:
      "Experimental Development phase (M13–M27): final builds and integration of the avionics/software (Synesthesia), mechanics & UAV integration (Rafla), TRL7 subsystem build & data validation (UniPV) and the final refuelling system & hangar (Inspire), culminating in the integrated TRL7 prototype, flight tests and demonstration-flight authorization. Milestones M4 (M+18), M5 (M+24), M6 (M+27).",
    actions: [
      { code: "SS 1", title: "SS 1 — Final Avionics System Build", owner: "Synesthesia S.r.l.", milestoneMonth: 18, description: "Build the complete avionics system and integrate all electronic components: procurement/integration of on-board sensors, compute/control units, communication and navigation systems; custom PCBs, power supply/distribution, bucket-control integration; redundancy systems and detailed avionics documentation to support certification." },
      { code: "SS 2", title: "SS 2 — Final Unmanned-Helicopter Software Development", owner: "Synesthesia S.r.l.", milestoneMonth: 18, description: "Implementation and integration of all software modules: optimisation of the embedded autonomous-flight software, safety/redundancy logic, interfaces with external systems (hangar, recharge), the mission-management software (coupling, recharge, liquid release), sensor/actuator drivers, performance optimisation, code versioning and full technical documentation." },
      { code: "SS 3", title: "SS 3 — Final Mechanical Components Build", owner: "Rafla S.r.l.", milestoneMonth: 18, description: "Build the final components and integrate the mechanical parts: automation interfaces and mounts for actuators/sensors, and the final structural modifications on the helicopter for the avionics and the bucket; quality control, structural checks and technical documentation." },
      { code: "SS 4", title: "SS 4 — Unmanned-Helicopter Systems Integration", owner: "Rafla S.r.l. + Synesthesia S.r.l.", milestoneMonth: 24, description: "Integrate the final avionics and mechanical modifications: Rafla coordinates physical installation, mechanical-interface verification and actuator calibration; Synesthesia handles avionics integration, control-software configuration and communications verification; includes interconnection checks and operating-parameter setup." },
      { code: "SS 5", title: "SS 5 — Subsystems Build & Integration for the TRL7 Prototype", owner: "Università di Pavia", milestoneMonth: 18, description: "Build and integrate the subsystems (including non-research components) for the TRL7 prototype: process analysis to optimise additive-manufacturing print parameters, and structural analysis of complex subsystems, using both commercial and open-source numerical libraries." },
      { code: "SS 6", title: "SS 6 — Experimental Data Validation (Digital Twin)", owner: "Università di Pavia", milestoneMonth: 27, description: "Validation of the experimental data: simplified models of the prototype for numerical simulations alongside the field tests; simulation and structural analysis of the critical components validated against the acquired field data, aiming at a digital twin of the prototype." },
      { code: "SS 7", title: "SS 7 — Final Refuelling System Build", owner: "Inspire S.r.l.", milestoneMonth: 18, description: "Build the final refuelling system: the >100 L bucket, quick-coupling, liquid-intake/vapour-recovery valves, the coupling flange, the instant liquid-release with automatic reset, and the pressurised hydraulic circuit with pumps sized for <30 s refuelling; built per UniPV's structural optimisations, using additive manufacturing where appropriate." },
      { code: "SS 8", title: "SS 8 — Hangar System Build — Mechatronics", owner: "Inspire S.r.l.", milestoneMonth: 18, description: "Build the Hangar system (mechatronics): the container's mechanical structure (20 ft), helicopter stowage for transport, the roof-opening and the automated lift for deploy/recovery, the tanks and the hydraulic plant integrated with the refuelling system; mechanical and hydraulic commissioning." },
      { code: "SS 9", title: "SS 9 — Hangar System Build — Automation Control", owner: "Inspire S.r.l.", milestoneMonth: 18, description: "Build the Hangar system (automation control): electrical cabinet, sensor/actuator wiring, PLC programming (roof opening, lift, deploy/recovery, refuelling), communication interfaces with the helicopter and safety logic; functional commissioning and emergency procedures." },
      { code: "SS 10", title: "SS 10 — Systems Integration (Full Prototype, TRL7)", owner: "Inspire S.r.l. + Rafla S.r.l. + Synesthesia S.r.l.", milestoneMonth: 24, description: "Systems integration into the complete TRL7 prototype: install/calibrate the control and automation hardware (actuators, sensors, avionics, FTS), integrate communications and the bucket, and the truck interfaces for automatic take-off/landing and in-flight refuelling; interconnection checks and operating-parameter setup." },
      { code: "SS 11", title: "SS 11 — Flight Tests", owner: "Inspire S.r.l. + Rafla S.r.l. + Synesthesia S.r.l.", milestoneMonth: 24, description: "A progressive flight-test campaign to demonstrate real-environment operation (TRL7): ground tests of the integrated system, controlled hover, basic manoeuvres, then full automatic missions simulating real scenarios; verification of emergency procedures, external-system interface tests, and performance validation across conditions." },
      { code: "SS 12", title: "SS 12 — Validation & Authorization for Demonstration Flights", owner: "Inspire S.r.l. + Rafla S.r.l. + Synesthesia S.r.l.", milestoneMonth: 27, description: "Validate the TRL7 prototype and obtain the demonstration-flight authorizations (ENAC): performance tests, documentation (risk analysis, operating procedures, usage limitations, experimental-flight plan), emergency procedures, preliminary operating manuals, personnel training and demonstration planning." },
    ],
  },
];

// Per-action [startMonth, endMonth] read from the GANTT X-marks (relative months,
// M1 = PROJECT_START). Durations match the X-counts; rows sort by start_date, so
// the board reads chronologically (true Gantt), not RI 1..16.
const WINDOWS = {
  "RI 1": [1, 4], "RI 2": [3, 6], "RI 3": [5, 9], "RI 4": [6, 12],
  "RI 5": [10, 12], "RI 6": [1, 4], "RI 7": [3, 6], "RI 8": [5, 8],
  "RI 9": [6, 12], "RI 10": [1, 5], "RI 11": [4, 9], "RI 12": [7, 12],
  "RI 13": [1, 5], "RI 14": [4, 9], "RI 15": [7, 12], "RI 16": [7, 12],
  "SS 1": [13, 17], "SS 2": [14, 18], "SS 3": [13, 17], "SS 4": [18, 21],
  "SS 5": [13, 18], "SS 6": [19, 27], "SS 7": [13, 18], "SS 8": [13, 21],
  "SS 9": [16, 21], "SS 10": [19, 23], "SS 11": [22, 24], "SS 12": [19, 27],
};

const MILESTONES = [
  { name: "M1 — Preliminary Requirements Analysis", month: 4 },
  { name: "M2 — Advanced Subsystem Design", month: 9 },
  { name: "M3 — Prototype Development & Test (end of Industrial Research)", month: 12 },
  { name: "M4 — Final Components Build", month: 18 },
  { name: "M5 — Integration & Joint Tests", month: 24 },
  { name: "M6 — Field Test in Real Conditions (TRL7, Surrigheddu)", month: 27 },
];

const milestoneLabel = (m) =>
  ({ 4: "M1", 9: "M2", 12: "M3", 18: "M4", 24: "M5", 27: "M6" })[m] || `M+${m}`;

// ---------------------------------------------------------------------------
// Supabase helpers.

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

let posCounter = 0;
const nextPos = () => `a${String((posCounter += 1)).padStart(6, "0")}`;
let roadmapCounter = 0;
const nextRoadmap = () => (roadmapCounter += 1);

// ---------------------------------------------------------------------------

async function seed() {
  const userId = await findUser(SEED_EMAIL);
  console.log(`Seeding as user ${SEED_EMAIL} (${userId})`);
  console.log(
    `Span: M1 ${monthDateStr(1)} → M27 ${monthDateStr(27)} (end ${monthDateStr(SPAN_MONTHS + 1)})`,
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

  const drive = await setupDrive();
  if (drive) {
    console.log(`Drive: docs in "${drive.folderName}"/<phase>/<action>/`);
  } else {
    console.log(
      "Drive: GOOGLE_SA_KEYFILE not set → deliverable links use the placeholder URL",
    );
  }

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

  for (const ph of PHASES) {
    const [anchorCard] = await call("cards", {
      list_id: parentTodoList,
      board_id: parentBoard.id,
      title: ph.title,
      position: nextPos(),
      roadmap_order: nextRoadmap(),
      type: "task",
      owner_id: null,
      description: `**Phase** · M${ph.startMonth}–M${ph.endMonth}\n\n${ph.description}`,
      start_date: monthDateStr(ph.startMonth),
      target_date: monthDateStr(ph.endMonth + 1),
    });

    const [subBoard] = await call("boards", {
      workspace_id: ws.id,
      parent_board_id: parentBoard.id,
      parent_card_id: anchorCard.id,
      title: ph.title,
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

    for (const a of ph.actions) {
      const ms = milestoneLabel(a.milestoneMonth);
      const [wStart, wEnd] = WINDOWS[a.code];
      const taskTarget = monthDateStr(wEnd + 1);

      // 1. Task card — real GANTT window; title suffixed with the owner tag.
      const [taskCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: `${a.title} - ${ownerTag(a.owner)}`,
        position: nextPos(),
        roadmap_order: nextRoadmap(),
        type: "task",
        owner_id: null,
        description: `**Task** · ${a.owner} · M${wStart}–M${wEnd} · feeds ${ms} (M+${a.milestoneMonth})\n\n${a.description}`,
        start_date: monthDateStr(wStart),
        target_date: taskTarget,
      });
      taskCount += 1;

      // 2. Deliverable subtask — 15 working days, ending on the task's finish.
      const descPart = a.title.split("— ").slice(1).join("— ").trim();
      const delvTitle = `D-${a.code.replace(/\s+/g, "")} — ${descPart}`;
      const [delCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: delvTitle,
        position: nextPos(),
        roadmap_order: nextRoadmap(),
        type: "subtask",
        owner_id: null,
        parent_card_id: taskCard.id,
        description: `**Deliverable** of ${a.code} · ${a.owner} · ${ms} (M+${a.milestoneMonth})\n\n15 working days, ending on the task's finish date.`,
        start_date: minusWorkingDays(taskTarget, 15),
        target_date: taskTarget,
      });
      delCount += 1;

      // 3. Drive doc (linked on the deliverable).
      let linkUrl = PLACEHOLDER_LINK_URL;
      if (drive) {
        const doc = await drive.docUrlFor(ph.title, a.title, delvTitle, {
          lead: a.owner,
          milestoneMonth: a.milestoneMonth,
        });
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
      `  ${ph.code}: anchor ${anchorCard.id}, sub-board ${subBoard.id}, ${ph.actions.length} tasks + ${ph.actions.length} deliverables`,
    );
  }

  // Milestones — dated at monthStart(month+1) so they sit on the task closures
  // (tasks end at target = monthStart(milestoneMonth+1)).
  for (const m of MILESTONES) {
    await call("milestones", {
      workspace_id: ws.id,
      board_id: parentBoard.id,
      name: m.name,
      date: monthStart(m.month + 1).toISOString(),
      created_by: userId,
    });
  }

  console.log("");
  const linkNote = drive
    ? `${linkCount} Drive-doc links (${docCreated} created, ${docReused} reused)`
    : `${linkCount} placeholder links`;
  console.log(
    `Done. ${PHASES.length} phases · ${taskCount} tasks · ${delCount} deliverables (${linkNote}) · ${MILESTONES.length} milestones.`,
  );
  console.log(`Open <your-domain>/w/${ws.id} — login as ${SEED_EMAIL}.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
