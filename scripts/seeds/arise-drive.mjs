#!/usr/bin/env node
// ARISE project-plan seeder WITH Google Drive subfolders + template docs.
// Parallel rebuild of scripts/seeds/arise.mjs under a NEW workspace name, so the
// original "ARISE Project" is left untouched.
//
// Source: ARISE Work Plan GANTT (updated — some deliverables split into pieces:
// D2.1 → D2.1A + D2.1B; the WP3 AI deliverable → D3.2 + D3.4). 5 WP · 20 tasks ·
// 21 deliverables → here 12 deliverables after the split.
//
// Structure (Swich/Wildfire machinery):
//   Workspace "ARISE — Project Plan"
//   └─ Parent board "ARISE · Project Plan" (5 WP anchor cards + 7 milestones)
//      └─ 5 sub-boards (WP1..WP5), each linked 1:1 to its anchor card
//         └─ Tx.y task-cards (type=task), GANTT M-ranges
//            └─ Dx.y deliverable-cards (type=subtask) parented to a task, dated
//               at their due month. Each carries a yellow link → its Google Doc.
//
// Google Drive: <DRIVE_FOLDER_ID>/<WP title>/Deliverables/<deliverable doc>.
// Each deliverable doc is a copy of the project .docx template
// (scripts/seeds/templates/arise.docx), uploaded via the Drive API — no Docs API.
// Find-or-create / idempotent (the SA cannot delete in a Shared Drive): re-seeding
// reuses the same folders/docs. The SA needs create rights on the base folder.
//
// Dates: calendar months. M1 = 21 May 2026; monthStart(25) = 21 May 2028 (24 mo).
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env:
//   SEED_EMAIL              owner; default "team@innovina.it"
//   SEED_WORKSPACE          workspace name; default "ARISE — Project Plan"
//   SEED_RESET              "true" wipes the (same-named) workspace before re-seeding
//   SEED_ENV_FILE           one-off env file (used by the prod runner)
//   GOOGLE_SA_KEYFILE       service-account JSON key → real Drive docs from template
//   ARISE_DRIVE_FOLDER_ID   base Drive folder; default below

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
const WORKSPACE_NAME = process.env.SEED_WORKSPACE || "ARISE — Project Plan";
const PARENT_BOARD_TITLE = "ARISE · Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

// Calendar-month dating. M1 = 21 May 2026; monthStart(25) = 21 May 2028 (24 mo).
const PROJECT_START = new Date("2026-05-21T09:00:00Z");
const SPAN_MONTHS = 24;
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

const PLACEHOLDER_LINK_COLOR = "#facc15"; // yellow diamond
const PLACEHOLDER_LINK_URL = "https://www.corriere.it";

// Responsible-org tag for task titles, matching the M.A.R.S. seeds' " - <org>"
// style. ARISE bakes the collaborator inline as "… (with Invenio)"; pull it out
// into the suffix. Tasks with no collaborator are Innovina-led → " - Innovina".
const ARISE_LEAD = "Innovina";
const orgTitle = (title) => {
  const m = title.match(/\s*\(with ([^)]+)\)\s*$/);
  return m
    ? `${title.slice(0, m.index)} - ${m[1]}`
    : `${title} - ${ARISE_LEAD}`;
};

// --- Google Drive (optional) -----------------------------------------------
const DRIVE_FOLDER_ID =
  process.env.ARISE_DRIVE_FOLDER_ID || "1X506gyhUdjO4rOc5q3_EKOzib-ES65tN";
const DELIVERABLE_SUBFOLDER =
  process.env.ARISE_DELIVERABLE_SUBFOLDER || "Deliverables";
// Each deliverable doc is a copy of the project .docx template (the ARISE
// skeleton with the "[Document short name]" placeholder stripped), uploaded via
// the Drive API — no Docs API. Built by scripts/seeds/build-templates.py.
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_DOCX = join(__dirname, "templates", "arise.docx");
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

  const cache = new Map();
  async function findFolder(name, parentId) {
    const key = `F ${parentId} ${name}`;
    if (cache.has(key)) return cache.get(key);
    const q = `name='${esc(name)}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const list = await drive.files.list({
      q,
      fields: "files(id,name)",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(driveId ? { corpora: "drive", driveId } : {}),
    });
    const hit = list.data.files?.[0];
    let res;
    if (hit) {
      res = hit;
    } else {
      const r = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        supportsAllDrives: true,
        fields: "id,name",
      });
      res = r.data;
    }
    cache.set(key, res);
    return res;
  }

  // Find a doc by name in parent; else upload the project .docx template into it
  // (Drive API only, no Docs API). Each deliverable doc is a fresh copy.
  async function findOrCreateDoc(name, parentId) {
    const key = `D ${parentId} ${name}`;
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
        requestBody: { name, mimeType: DOCX_MIME, parents: [parentId] },
        media: { mimeType: DOCX_MIME, body: createReadStream(TEMPLATE_DOCX) },
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
    fromTemplate: true,
    // <folder>/<WP title>/<Deliverables>/<doc>  (doc = copy of templates/arise.docx)
    async docUrlFor(wpName, docName) {
      const wpFolder = await findFolder(wpName, DRIVE_FOLDER_ID);
      const delFolder = await findFolder(DELIVERABLE_SUBFOLDER, wpFolder.id);
      const doc = await findOrCreateDoc(docName, delFolder.id);
      return { url: doc.webViewLink, created: doc.created };
    },
  };
}

// ---------------------------------------------------------------------------
// ARISE — 5 WP · 20 tasks · 12 deliverables (post-split). Task spans + descriptions
// reused from scripts/seeds/arise.mjs; deliverables updated to the split GANTT.
// Each deliverable: dueMonth + underTaskIndex (parent task within its WP).

const WORK_PACKAGES = [
  {
    code: "WP1",
    title: "WP1 — Project Management, Requirements and Dissemination",
    kind: "Transversal",
    startMonth: 1,
    endMonth: 24,
    description:
      "Project management, definition of clinical and technical requirements, compliance management and dissemination of results.",
    tasks: [
      {
        code: "T1.1",
        title: "T1.1 Project Management and Coordination",
        startMonth: 1,
        endMonth: 24,
        description:
          "Overall project coordination, planning, reporting, risk management and consortium governance across the full 24-month duration.",
      },
      {
        code: "T1.2",
        title: "T1.2 Compliance Management (GDPR/MDR) and Data",
        startMonth: 1,
        endMonth: 24,
        description:
          "GDPR and MDR compliance, data-protection impact assessments, data governance and ethics oversight throughout the project lifecycle.",
      },
      {
        code: "T1.3",
        title:
          "T1.3 Definition of Clinical Requirements and Protocol (with Partners)",
        startMonth: 1,
        endMonth: 6,
        description:
          "Elicit clinical requirements and biomechanical KPIs with DINOGMI and Studio Buccarella; produce the TRL6 validation protocol and prepare the Ethics Committee submission.",
      },
      {
        code: "T1.4",
        title: "T1.4 Dissemination and Exploitation of Results",
        startMonth: 19,
        endMonth: 24,
        description:
          "Final-phase dissemination activities (publications, events, exploitation plan) and stakeholder communication.",
      },
    ],
    deliverables: [
      {
        code: "D1.1",
        title:
          "D1.1 — Clinical Requirements and Biomechanical KPIs Document (with DINOGMI)",
        dueMonth: 3,
        underTaskIndex: 2,
        description:
          "Baseline clinical requirements and biomechanical KPIs co-authored with DINOGMI, anchoring the validation strategy.",
      },
      {
        code: "D1.2",
        title:
          "D1.2 — TRL6 Validation Protocol and Ethics Committee Submission (with Studio Buccarella)",
        dueMonth: 6,
        underTaskIndex: 2,
        description:
          "TRL6 validation protocol with Studio Buccarella plus the documentation submitted to the Ethics Committee.",
      },
      {
        code: "D1.3",
        title: "D1.3 — Final Report and Dissemination Plan",
        dueMonth: 24,
        underTaskIndex: 3,
        description:
          "Final project report and dissemination plan covering scientific results, exploitation pathways and post-project follow-up.",
      },
    ],
  },
  {
    code: "WP2",
    title: "WP2 — Market Analysis and System Architecture",
    kind: "Industrial Research",
    startMonth: 3,
    endMonth: 9,
    description:
      "Define market strategy versus the state of the art (pressure plates) and design the software/cloud architecture and user interfaces.",
    tasks: [
      {
        code: "T2.1",
        title:
          "T2.1 Cloud Architecture and Data Protocol Definition (with Invenio)",
        startMonth: 3,
        endMonth: 9,
        description:
          "Define cloud/edge architecture, data model and exchange protocols between the Coach device and the clinical platform.",
      },
      {
        code: "T2.2",
        title: "T2.2 Market Approaches and Strategy Analysis (with Invenio)",
        startMonth: 3,
        endMonth: 6,
        description:
          "Competitive analysis versus pressure plates and adjacent clinical-assessment products; positioning and go-to-market strategy.",
      },
      {
        code: "T2.3",
        title: "T2.3 UI/UX Design (Coach and Dashboard) (with Invenio)",
        startMonth: 3,
        endMonth: 9,
        description:
          "UI/UX design for the Coach (patient-facing) and the Clinical Dashboard (therapist-facing): flows, mockups, accessibility checks.",
      },
    ],
    deliverables: [
      {
        code: "D2.1A",
        title: "D2.1A — Market Analysis Document (vs. Pressure Plates)",
        dueMonth: 9,
        underTaskIndex: 1,
        description:
          "Market analysis versus pressure-plate competitors and adjacent clinical-assessment products (split from the former D2.1).",
      },
      {
        code: "D2.1B",
        title: "D2.1B — Cloud/Edge Architecture",
        dueMonth: 9,
        underTaskIndex: 0,
        description:
          "Cloud/edge architecture specification and data protocol (split from the former D2.1).",
      },
      {
        code: "D2.2",
        title: "D2.2 — UI/UX Specifications and Mockups (Patient and Therapist)",
        dueMonth: 9,
        underTaskIndex: 2,
        description:
          "UI/UX specifications and validated mockups for both patient and therapist applications.",
      },
    ],
  },
  {
    code: "WP3",
    title: "WP3 — Core AI Research and Hardware Design",
    kind: "Industrial Research",
    startMonth: 6,
    endMonth: 15,
    description:
      "Create AI assets (3D measurement and forecasting) and engineer the Coach device.",
    tasks: [
      {
        code: "T3.1",
        title: "T3.1 Comparative Study of Sensors (RI Prototypes) (with Invenio)",
        startMonth: 6,
        endMonth: 12,
        description:
          "Compare RGB / RGB-D / NOSE sensors via research-instrument prototypes to select the Coach sensing stack.",
      },
      {
        code: "T3.2",
        title:
          "T3.2 STS Dataset Acquisition and Annotation (with Clinical Partners)",
        startMonth: 6,
        endMonth: 12,
        description:
          "Acquire and annotate the Sit-To-Stand (STS) dataset with clinical partners for AI model training and validation.",
      },
      {
        code: "T3.3",
        title: "T3.3 3D Measurement AI Model Development (with Invenio)",
        startMonth: 7,
        endMonth: 15,
        description:
          "Develop the 3D pose / biomechanical-measurement AI model and validate against the gold-standard clinical reference.",
      },
      {
        code: "T3.4",
        title: "T3.4 Predictive AI Model Development (Forecasting) (with Invenio)",
        startMonth: 7,
        endMonth: 15,
        description:
          "Develop the forecasting AI model to predict patient trajectories and clinical-risk indicators.",
      },
      {
        code: "T3.5",
        title: "T3.5 Coach Hardware Design and Cloud Platform",
        startMonth: 7,
        endMonth: 12,
        description:
          "Detailed hardware design of the Coach device and the cloud-platform architecture supporting it.",
      },
    ],
    deliverables: [
      {
        code: "D3.1",
        title: "D3.1 — Sensor Comparison Study Report (RGB / RGB-D / NOSE)",
        dueMonth: 9,
        underTaskIndex: 0,
        description:
          "Report on the sensor comparison study, with a recommendation for the Coach sensing configuration.",
      },
      {
        code: "D3.2",
        title: "D3.2 — AI Model Search & Comparison (best-results selection)",
        dueMonth: 9,
        underTaskIndex: 2,
        description:
          "Search and comparison of candidate AI models to achieve the best results (split from the former combined AI deliverable).",
      },
      {
        code: "D3.3",
        title: "D3.3 — Hardware Design and Planning Document",
        dueMonth: 12,
        underTaskIndex: 4,
        description:
          "Hardware design and planning document for the Coach device and supporting cloud platform.",
      },
      {
        code: "D3.4",
        title: "D3.4 — Preliminary Test of AI Models (3D Pose + Forecasting)",
        dueMonth: 15,
        underTaskIndex: 3,
        description:
          "Preliminary test of the 3D pose-measurement and forecasting AI models against the validation KPIs (split from the former combined AI deliverable).",
      },
    ],
  },
  {
    code: "WP4",
    title: "WP4 — Platform Prototyping (Hardware and Software)",
    kind: "Experimental Development",
    startMonth: 12,
    endMonth: 18,
    description:
      "Build and integrate the TRL6 system (Coach device + Clinical Dashboard).",
    tasks: [
      {
        code: "T4.1",
        title: "T4.1 Coach Hardware Prototyping (Experimental Development)",
        startMonth: 12,
        endMonth: 18,
        description:
          "Build the Coach hardware prototypes (5-10 units) and run hardware bring-up and qualification.",
      },
      {
        code: "T4.2",
        title:
          "T4.2 On-Device Software Development and Biofeedback (with Invenio)",
        startMonth: 12,
        endMonth: 18,
        description:
          "On-device firmware/software and biofeedback loop integrated with the AI inference pipeline.",
      },
      {
        code: "T4.3",
        title: "T4.3 Backend Development and Clinical Dashboard Frontend (with Invenio)",
        startMonth: 13,
        endMonth: 18,
        description:
          "Cloud backend and Clinical Dashboard frontend (therapist application) wired to the data protocol from WP2.",
      },
      {
        code: "T4.4",
        title: "T4.4 System Integration and Testing (Hardware/Software/AI)",
        startMonth: 13,
        endMonth: 18,
        description:
          "End-to-end integration and lab testing across hardware, software and AI components ahead of clinical validation.",
      },
    ],
    deliverables: [
      {
        code: "D4.1",
        title:
          "D4.1 — TRL6 Prototype (5-10 Coach units + Cloud Platform) Integrated and Lab-Tested",
        dueMonth: 18,
        underTaskIndex: 3,
        description:
          "TRL6 prototype: 5-10 integrated Coach units plus the cloud platform, lab-tested end-to-end.",
      },
    ],
  },
  {
    code: "WP5",
    title: "WP5 — TRL6 Clinical Validation and User Testing",
    kind: "Clinical Validation",
    startMonth: 19,
    endMonth: 24,
    description:
      "Demonstrate and validate the effectiveness, accuracy and usability of the system in a real clinical environment.",
    tasks: [
      {
        code: "T5.1",
        title: "T5.1 Clinical Setup (Installation at Studio Buccarella)",
        startMonth: 19,
        endMonth: 21,
        description:
          "Install the TRL6 system at Studio Buccarella and complete site qualification before the clinical trial.",
      },
      {
        code: "T5.2",
        title: "T5.2 Clinical Trial Execution (with Real Patients)",
        startMonth: 20,
        endMonth: 23,
        description:
          "Execute the clinical trial with real patients per the validation protocol baselined in WP1.",
      },
      {
        code: "T5.3",
        title: "T5.3 Usability Feedback Collection (Patients and Therapists)",
        startMonth: 20,
        endMonth: 23,
        description:
          "Collect structured usability feedback from patients and therapists across the trial.",
      },
      {
        code: "T5.4",
        title: "T5.4 Data Analysis and Accuracy Validation (with DINOGMI)",
        startMonth: 22,
        endMonth: 24,
        description:
          "Analyse trial data and validate accuracy against the DINOGMI gold-standard and the Studio Buccarella usability baseline.",
      },
    ],
    deliverables: [
      {
        code: "D5.1",
        title:
          "D5.1 — Final TRL6 Validation Report (Accuracy vs DINOGMI; Usability vs Studio Buccarella)",
        dueMonth: 24,
        underTaskIndex: 3,
        description:
          "Final TRL6 validation report: accuracy versus the DINOGMI gold-standard and usability versus the Studio Buccarella baseline.",
      },
    ],
  },
];

const MILESTONES = [
  { name: "M1 — Clinical Requirements and KPIs Approved", month: 3 },
  { name: "M2 — TRL6 Validation Protocol Submitted (Ethics)", month: 6 },
  { name: "M3 — Architecture and UI/UX Designed", month: 9 },
  { name: "M4 — Coach Hardware Design Frozen", month: 12 },
  { name: "M5 — AI Models (3D + Forecasting) Tested", month: 15 },
  { name: "M6 — TRL6 Prototype Integrated", month: 18 },
  { name: "M7 — TRL6 Clinical Validation Complete", month: 24 },
];

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

  // Resolve Drive up front so a misconfigured folder/SA/template fails before any
  // Supabase write (no half-seeded workspace on a Drive error).
  const drive = await setupDrive();
  if (drive) {
    console.log(
      `Drive: docs in "${drive.folderName}"/<WP>/${DELIVERABLE_SUBFOLDER}/ — ${
        drive.fromTemplate ? "copies of templates/arise.docx" : "empty docs"
      }`,
    );
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

  positionCounter = 0;
  for (const wp of WORK_PACKAGES) {
    const [anchorCard] = await call("cards", {
      list_id: parentTodoList,
      board_id: parentBoard.id,
      title: wp.title,
      position: nextPos(),
      type: "task",
      owner_id: null,
      description: `**${wp.kind}** · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
      start_date: monthDateStr(wp.startMonth),
      target_date: monthDateStr(wp.endMonth + 1),
    });

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

    const taskRows = [];
    for (const t of wp.tasks) {
      const [row] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: orgTitle(t.title),
        position: nextPos(),
        type: "task",
        owner_id: null,
        description: `**Task** · ${wp.code}\n\n${t.description}`,
        start_date: monthDateStr(t.startMonth),
        target_date: monthDateStr(t.endMonth + 1),
      });
      taskRows.push(row);
      taskCount += 1;
    }

    for (const d of wp.deliverables) {
      const parent = taskRows[d.underTaskIndex ?? 0];
      if (!parent)
        throw new Error(`${wp.code} ${d.code}: underTaskIndex out of bounds`);
      const [delCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: d.title,
        position: nextPos(),
        type: "subtask",
        owner_id: null,
        parent_card_id: parent.id,
        description: `**Deliverable** · ${wp.code} · due M${d.dueMonth}\n\n${d.description}`,
        start_date: monthDateStr(d.dueMonth),
        target_date: monthDateStr(d.dueMonth + 1),
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

  for (const m of MILESTONES) {
    await call("milestones", {
      workspace_id: ws.id,
      board_id: parentBoard.id,
      name: m.name,
      // +1 so the milestone marker lands on the task closures (tasks end at
      // target = monthStart(endMonth+1), i.e. the start of the next month).
      date: monthStart(m.month + 1).toISOString(),
      created_by: userId,
    });
  }

  console.log("");
  const linkNote = drive
    ? `${linkCount} Drive-doc links (${docCreated} created, ${docReused} reused)`
    : `${linkCount} placeholder links`;
  console.log(
    `Done. ${WORK_PACKAGES.length} WP · ${taskCount} tasks · ${delCount} deliverables (${linkNote}) · ${MILESTONES.length} milestones.`,
  );
  console.log(`Open <your-domain>/w/${ws.id} — login as ${SEED_EMAIL}.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
