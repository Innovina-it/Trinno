#!/usr/bin/env node
// ARISE project plan seeder — anchor-card + sub-board format.
// Mirrors aiwepi.mjs. Source: scripts/seeds/Arise.docx (Work Plan GANTT).
//
// Structure
//   Workspace "ARISE Project"
//   └─ Parent board "ARISE Project Plan" (5 WP anchor cards + plan milestones)
//      └─ 5 sub-boards (WP1..WP5), each linked to its anchor via
//         boards.parent_card_id
//         └─ Tx.y task-cards (type=task) with explicit M-ranges from GANTT
//            └─ Dx.y deliverable-cards (type=subtask) parented to tasks
//
// Differences vs aiwepi.mjs
//   - Per-task startMonth/endMonth pulled directly from GANTT X-marks
//     (aiwepi sliced WP range evenly; ARISE has transversal + irregular spans).
//   - Per-deliverable dueMonth (M3, M6, M9, M12, M15, M18, M24) drives a short
//     bar ending on that month, anchored to its parent task.
//   - Milestones derived from deliverable due dates.
//
// Env: same as aiwepi.mjs.
//   SEED_EMAIL          default "team@innovina.it"
//   SEED_WORKSPACE      default "ARISE Project"
//   SEED_CURRENT_MONTH  1..24, synthetic "today"; default 5
//   SEED_RESET          "true" wipes existing workspace before re-seeding
//   SEED_ENV_FILE       one-off env file (used by ./scripts/seeds/run.sh)

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
const WORKSPACE_NAME = process.env.SEED_WORKSPACE || "ARISE Project";
const CURRENT_MONTH = Number(process.env.SEED_CURRENT_MONTH ?? "5");
const PARENT_BOARD_TITLE = "ARISE Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

const DAY_MS = 86_400_000;
const PROJECT_START = new Date("2026-01-15T09:00:00Z");
const monthStart = (m) =>
  new Date(PROJECT_START.getTime() + (m - 1) * 30 * DAY_MS);
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

// ---------------------------------------------------------------------------
// ARISE — 5 WPs, 18 tasks, 9 deliverables.
// Task start/end months read off the GANTT X-marks (M1-M6 / M7-M12 / M13-M18 /
// M19-M24 quadrants). Deliverables span a 2-month tail ending on dueMonth.

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
          "Elicit clinical requirements and biomechanical KPIs with DYNOGMS and Studio Buccarella; produce the TRL6 validation protocol and prepare the Ethics Committee submission.",
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
          "D1.1 Clinical Requirements and Biomechanical KPIs Document (with DYNOGMS)",
        dueMonth: 3,
        underTaskIndex: 2,
        description:
          "Baseline clinical requirements and biomechanical KPIs co-authored with DYNOGMS, anchoring the validation strategy.",
      },
      {
        code: "D1.2",
        title:
          "D1.2 TRL6 Validation Protocol and Ethics Committee Submission (with Studio Buccarella)",
        dueMonth: 6,
        underTaskIndex: 2,
        description:
          "TRL6 validation protocol with Studio Buccarella plus the documentation submitted to the Ethics Committee.",
      },
      {
        code: "D1.3",
        title: "D1.3 Final Report and Dissemination Plan",
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
        code: "D2.1",
        title:
          "D2.1 Market Analysis Document (vs. Pressure Plates) and Cloud/Edge Architecture",
        dueMonth: 9,
        underTaskIndex: 0,
        description:
          "Market analysis versus pressure-plate competitors bundled with the cloud/edge architecture specification.",
      },
      {
        code: "D2.2",
        title: "D2.2 UI/UX Specifications and Mockups (Patient and Therapist)",
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
        title: "D3.1 Sensor Comparison Study Report (RGB / RGB-D / NOSE)",
        dueMonth: 9,
        underTaskIndex: 0,
        description:
          "Report on the sensor comparison study, with recommendation for the Coach sensing configuration.",
      },
      {
        code: "D3.2",
        title:
          "D3.2 AI Models (3D Pose + Forecasting) Trained and Validated",
        dueMonth: 15,
        underTaskIndex: 2,
        description:
          "Trained and validated 3D pose-measurement and forecasting AI models, with performance against the validation KPIs.",
      },
      {
        code: "D3.3",
        title: "D3.3 Hardware Design and Planning Document",
        dueMonth: 12,
        underTaskIndex: 4,
        description:
          "Hardware design and planning document for the Coach device and supporting cloud platform.",
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
          "D4.1 TRL6 Prototype (5-10 Coach units + Cloud Platform) Integrated and Lab-Tested",
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
    kind: "Experimental Development",
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
          "Analyse trial data and validate accuracy against the DINOGMI gold-standard and the Buccarella usability baseline.",
      },
    ],
    deliverables: [
      {
        code: "D5.1",
        title:
          "D5.1 Final TRL6 Validation Report (Accuracy vs DINOGMI; Usability vs Studio Buccarella)",
        dueMonth: 24,
        underTaskIndex: 3,
        description:
          "Final TRL6 validation report: accuracy versus DINOGMI gold-standard and usability versus the Studio Buccarella baseline.",
      },
    ],
  },
];

const MILESTONES = [
  { name: "M1 Clinical Requirements and KPIs Approved", endMonth: 3 },
  { name: "M2 TRL6 Validation Protocol Submitted (Ethics)", endMonth: 6 },
  { name: "M3 Architecture and UI/UX Designed", endMonth: 9 },
  { name: "M4 Coach Hardware Design Frozen", endMonth: 12 },
  { name: "M5 AI Models (3D + Forecasting) Validated", endMonth: 15 },
  { name: "M6 TRL6 Prototype Integrated", endMonth: 18 },
  { name: "M7 TRL6 Clinical Validation Complete", endMonth: 24 },
];

// ---------------------------------------------------------------------------
// Status from synthetic CURRENT_MONTH.

function statusFor(startMonth, endMonth) {
  if (endMonth <= CURRENT_MONTH) return "done";
  if (startMonth <= CURRENT_MONTH) return "in_progress";
  return "todo";
}

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
  if (
    !Number.isFinite(CURRENT_MONTH) ||
    CURRENT_MONTH < 1 ||
    CURRENT_MONTH > 24
  ) {
    throw new Error(
      `SEED_CURRENT_MONTH out of range (1..24): ${CURRENT_MONTH}`,
    );
  }

  const userId = await findUser(SEED_EMAIL);
  console.log(
    `Seeding as user ${SEED_EMAIL} (${userId}) — synthetic CURRENT_MONTH = ${CURRENT_MONTH}`,
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
  console.log(
    `  feature_flags ON: ${Object.entries(WORKSPACE_FEATURE_FLAGS)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ") || "(all off)"}`,
  );

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
  const parentList = { id: parentLists.todo };

  positionCounter = 0;
  for (const wp of WORK_PACKAGES) {
    const [anchorCard] = await call("cards", {
      list_id: parentList.id,
      board_id: parentBoard.id,
      title: wp.title,
      position: nextPos(),
      type: "task",
      owner_id: null,
      description: `**${wp.kind}** · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
      start_date: monthDateStr(wp.startMonth),
      target_date: monthDateStr(wp.endMonth),
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
    console.log(
      `  ${wp.code} sub-board: ${subBoard.id} (anchor card ${anchorCard.id})`,
    );

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
    const subList = { id: subLists.todo };

    const taskRows = [];
    for (const t of wp.tasks) {
      const [row] = await call("cards", {
        list_id: subList.id,
        board_id: subBoard.id,
        title: t.title,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description: t.description,
        start_date: monthDateStr(t.startMonth),
        target_date: monthDateStr(t.endMonth),
      });
      taskRows.push({ row, taskStart: t.startMonth, taskEnd: t.endMonth });
    }

    for (const d of wp.deliverables) {
      const parent = taskRows[d.underTaskIndex ?? 0];
      if (!parent)
        throw new Error(`${wp.code} ${d.code}: underTaskIndex out of bounds`);
      // Deliverable: 2-month tail ending on dueMonth, clamped to parent task span.
      const dEnd = d.dueMonth;
      const dStart = Math.max(parent.taskStart, dEnd - 2);
      await call("cards", {
        list_id: subList.id,
        board_id: subBoard.id,
        title: d.title,
        position: nextPos(),
        type: "subtask",
        owner_id: null,
        parent_card_id: parent.row.id,
        description: d.description,
        start_date: monthDateStr(dStart),
        target_date: monthDateStr(dEnd),
      });
    }
  }

  for (const m of MILESTONES) {
    await call("milestones", {
      workspace_id: ws.id,
      board_id: parentBoard.id,
      name: m.name,
      date: monthStart(m.endMonth).toISOString(),
      created_by: userId,
    });
  }
  console.log(`Milestones: ${MILESTONES.length}`);

  console.log("");
  console.log(
    `Done. Open <your-domain>/w/${ws.id} — login as ${SEED_EMAIL}.`,
  );
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
