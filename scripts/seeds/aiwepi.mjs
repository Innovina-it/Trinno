#!/usr/bin/env node
// AIWEPI / Switch project plan seeder — anchor-card + sub-board format.
//
// Logical structure
//   Workspace "AIWEPI Switch"
//   └─ Parent board "AIWEPI Project Plan"  (carries 5 WP anchor cards + 5 plan milestones)
//      └─ 5 sub-boards, one per WP, each linked 1:1 to its anchor card via
//         boards.parent_card_id (migration 0105)
//         └─ each sub-board:
//            ├─ Tx.y task-cards (type=task)        ← children of the anchor card, dates sliced from the WP range
//            └─ Dx.y.z deliverable-cards (subtask) ← children of their related task
//
// What's intentionally different from the older flat seed
//   - Sub-boards under a parent (migration 0099 — `boards.parent_board_id`).
//   - Each sub-board is anchored 1:1 to a card on the parent board via
//     `boards.parent_card_id` (migration 0105). The roadmap's
//     `groupBySubBoard` builds lanes from this anchor → sub-board mapping.
//   - `workspaces.feature_flags` set on the seeded workspace (migration 0102)
//     so the sub-board / shared-cache flags are ON for this fixture.
//   - Plan milestones live in the `milestones` table (migration 0095) anchored
//     to the parent board so they pin on the roadmap.
//   - Tasks get their OWN narrower date range (sliced from the WP span)
//     instead of inheriting the full WP range; otherwise the roadmap would
//     show every child task spanning the whole WP.
//   - Cards land in Todo / In Progress / Done based on a synthetic
//     CURRENT_MONTH anchor, so the roadmap + board reflect a project
//     mid-flight instead of an all-zeros state.
//   - `lists.status_kind` set on INSERT (no follow-up UPDATE, no trigger flak).
//   - `owner_id` set on INSERT (trigger from migration 0081 blocks owner_id
//     UPDATEs by service-role JWTs — INSERT is fine).
//   - Every card is unassigned: `owner_id = null` and no `card_members` row.
//     SEED_EMAIL is still the workspace owner + board admin (so they see
//     the workspace), but the project-plan cards themselves are unowned.
//     This makes the AIWEPI workspace behave like a fresh project template
//     where the user picks up cards by self-assigning. Result: "Mine" is
//     empty, "All" shows every card, "Unassigned" matches "All".
//     Filter rule: lib/roadmap/filtering.ts → isRoadmapAssignedToViewer.
//
// Required env
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Optional env
//   SEED_EMAIL          — owner; default "team@innovina.it"
//   SEED_WORKSPACE      — workspace name; default "AIWEPI Switch"
//   SEED_CURRENT_MONTH  — 1..24, synthetic "today" anchor; default 5
//   SEED_RESET          — "true" wipes existing workspace before re-seeding
//   SEED_ENV_FILE       — path to a one-off env file; bypasses dotenv/rtk
//                          interference (used by ./scripts/seeds/run.sh)
//
// Run via ./scripts/seeds/run.sh — it handles env discovery, sensitive-flag
// prompts, and safety guards.

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
const WORKSPACE_NAME = process.env.SEED_WORKSPACE || "AIWEPI Switch";
const CURRENT_MONTH = Number(process.env.SEED_CURRENT_MONTH ?? "5");
const PARENT_BOARD_TITLE = "AIWEPI Project Plan";
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

// Single neutral list per board — no status_kind so the roadmap renders
// bars as plain content (no Todo/In Progress/Done tint). Status routing
// removed for this fixture; cards show as title + dates only.
const NEUTRAL_LIST_TITLE = "Items";

// ---------------------------------------------------------------------------
// Content — AIWEPI project plan, 5 WPs, 11 tasks, 11 deliverables, 5 milestones.

const WORK_PACKAGES = [
  {
    code: "WP1.1",
    title: "WP1.1 — Scenario Analysis and Application Domains",
    kind: "Industrial Research",
    startMonth: 1,
    endMonth: 3,
    description:
      "Analysis of relevant use-case scenarios as the starting point for designing and developing the AIWEPI solution within the emerging Intelligent Welding Systems (IWS) market, targeting instrumentation-free welding helmet integration.",
    tasks: [
      {
        code: "T1.1",
        title: "T1.1 Operational Context Analysis, Scenarios and Use Cases",
        description:
          "Survey the operational environments where AIWEPI will be deployed, identifying key actors, workflows, and failure modes. Define representative use cases that drive requirements and design decisions.",
      },
    ],
    deliverables: [
      {
        code: "D1.1.1",
        title: "D1.1.1 Application Context, State of the Art and Use Cases",
        description:
          "Structured document mapping the current welding-industry landscape, competitive technologies, and validated use-case scenarios that establish the scope and positioning of the AIWEPI system.",
        underTaskIndex: 0,
      },
    ],
  },
  {
    code: "WP1.2",
    title:
      "WP1.2 — Definition of Architectural, Functional and Interoperability Requirements",
    kind: "Industrial Research",
    startMonth: 3,
    endMonth: 6,
    description:
      "Iterative/incremental development model covering a modular HW platform and a microservices SW framework. Includes requirements gathering, HW/SW technology baseline, and state-of-the-art review of AI in industrial welding.",
    tasks: [
      {
        code: "T2.1",
        title: "T2.1 Requirements Engineering",
        description:
          "Elicit, document, and baseline all functional, non-functional, and interoperability requirements through stakeholder workshops and analysis of the WP1.1 use cases. Produce a traceable requirements specification.",
      },
      {
        code: "T2.2",
        title: "T2.2 AI Applications in Industrial Welding — State of the Art",
        description:
          "Systematic literature and patent review covering AI-based anomaly detection, process monitoring, and quality control in industrial welding contexts. Identify gaps AIWEPI is positioned to address.",
      },
    ],
    deliverables: [
      {
        code: "D1.2.1",
        title: "D1.2.1 Functional, Non-Functional and Technical Requirements",
        description:
          "Baseline requirements specification covering all functional capabilities, performance targets, safety constraints, and interoperability interfaces derived from stakeholder input and use-case analysis.",
        underTaskIndex: 0,
      },
      {
        code: "D1.2.2",
        title: "D1.2.2 AI Applications in Industrial Welding",
        description:
          "State-of-the-art report reviewing existing AI techniques applied to weld process monitoring and quality assessment, benchmarking them against AIWEPI's target capabilities and identifying the innovation delta.",
        underTaskIndex: 1,
      },
    ],
  },
  {
    code: "WP1.3",
    title: "WP1.3 — Sub-Component Specification and Design",
    kind: "Industrial Research",
    startMonth: 6,
    endMonth: 12,
    description:
      "Specification and design of all AIWEPI sub-components: architectural model, AI models for anomaly detection, UX, technical services, and end-user support workflows.",
    tasks: [
      {
        code: "T3.1",
        title: "T3.1 AIWEPI Architecture Design",
        description:
          "Define the full architectural model for the AIWEPI system, including hardware topology, software layering, data flows between Smart Glove and Edge Computer, and integration interfaces with external systems.",
      },
      {
        code: "T3.2",
        title: "T3.2 AI Algorithm Design",
        description:
          "Design the machine-learning and signal-processing algorithms for real-time weld anomaly detection, specifying model architectures, training data requirements, inference latency targets, and update strategies.",
      },
      {
        code: "T3.3",
        title: "T3.3 Human-Machine Interface Design",
        description:
          "Design the HMI for welders and process supervisors, covering visual feedback, alert mechanisms, and accessibility constraints imposed by the welding-helmet form factor and industrial environment conditions.",
      },
    ],
    deliverables: [
      {
        code: "D1.3.1",
        title: "D1.3.1 AIWEPI Solution Architecture Design",
        description:
          "Detailed architecture design specifying the hardware/software decomposition, communication protocols, data pipeline, and integration contracts for all AIWEPI sub-components.",
        underTaskIndex: 0,
      },
      {
        code: "D1.3.2",
        title: "D1.3.2 AI Algorithm Design",
        description:
          "Design specification for the anomaly-detection and process-monitoring AI models, including dataset strategy, feature engineering approach, selected model families, and evaluation criteria.",
        underTaskIndex: 1,
      },
      {
        code: "D1.3.3",
        title: "D1.3.3 Human-Machine Interface Design",
        description:
          "HMI design artefacts (wireframes, interaction flows, prototype mockups) for the welder-facing and supervisor-facing interfaces, validated against usability criteria for high-noise industrial environments.",
        underTaskIndex: 2,
      },
    ],
  },
  {
    code: "WP1.4",
    title: "WP1.4 — Sub-Component Implementation and Integration",
    kind: "Experimental Development",
    startMonth: 11,
    endMonth: 19,
    description:
      "Incremental implementation of HW/SW sub-components (Smart Glove + Edge Computer) with progressive integration. Three prototype stages: Alpha (unit), Beta (integration), Final (orchestrated).",
    tasks: [
      {
        code: "T4.1",
        title: "T4.1 Alpha Prototype Implementation",
        description:
          "Implement and unit-test individual AIWEPI sub-components in isolation, covering firmware for the Smart Glove sensors and the initial edge-inference pipeline, producing the Alpha prototype artefacts.",
      },
      {
        code: "T4.2",
        title: "T4.2 Beta Prototype Implementation",
        description:
          "Integrate validated Alpha sub-components into a working Beta prototype, conducting integration testing across hardware-software boundaries and resolving inter-component interface issues.",
      },
      {
        code: "T4.3",
        title: "T4.3 Final Prototype Implementation",
        description:
          "Assemble and harden the full-system Final prototype from Beta-validated components, applying performance optimisations, reliability fixes, and end-to-end test campaigns in preparation for the demonstrator phase.",
      },
    ],
    deliverables: [
      {
        code: "D1.4.1",
        title: "D1.4.1 AIWEPI Sub-Components: Alpha Prototype",
        description:
          "Physical and software artefacts constituting the Alpha prototype, together with unit-test reports confirming each sub-component meets its individual specification.",
        underTaskIndex: 0,
      },
      {
        code: "D1.4.2",
        title: "D1.4.2 AIWEPI Sub-Components: Beta Prototype",
        description:
          "Integrated Beta prototype artefacts and integration-test report documenting interface conformance, data flow correctness, and identified defects resolved before the Final prototype stage.",
        underTaskIndex: 1,
      },
      {
        code: "D1.4.3",
        title: "D1.4.3 AIWEPI Sub-Components: Final Prototype",
        description:
          "Full-system Final prototype ready for demonstrator integration, accompanied by end-to-end test results, performance benchmarks, and a known-issues register with mitigations.",
        underTaskIndex: 2,
      },
    ],
  },
  {
    code: "WP1.5",
    title: "WP1.5 — Final Demonstrator Integration and Validation (TRL5)",
    kind: "Experimental Development",
    startMonth: 19,
    endMonth: 24,
    description:
      "Incremental integration of sub-components into a stable final demonstrator (TRL5), validated in real-world use scenarios with welders and process managers, with the Istituto Italiano di Saldatura involved.",
    tasks: [
      {
        code: "T5.1",
        title: "T5.1 Final Demonstrator Integration and Verification",
        description:
          "Integrate all Final-prototype sub-components into the AIWEPI demonstrator, execute system-level verification against the WP1.2 requirements baseline, and document residual non-conformances.",
      },
      {
        code: "T5.2",
        title: "T5.2 Demonstrator Validation",
        description:
          "Structured validation trials with target end-users (welders and process supervisors) and the Istituto Italiano di Saldatura, measuring KPIs against TRL5 criteria and capturing user feedback.",
      },
    ],
    deliverables: [
      {
        code: "D1.5.1",
        title: "D1.5.1 AIWEPI Integrated Demonstrator",
        description:
          "Fully assembled AIWEPI demonstrator integrating all HW and SW sub-components, with configuration documentation and a deployment guide for validation-site setup.",
        underTaskIndex: 0,
      },
      {
        code: "D1.5.2",
        title: "D1.5.2 Demonstrator Validation: Methodology and Results",
        description:
          "Validation report detailing trial methodology, quantitative performance results against TRL5 acceptance criteria, user-feedback analysis, and recommended next steps for exploitation.",
        underTaskIndex: 1,
      },
    ],
  },
];

const MILESTONES = [
  { name: "M1.1 Market Analysis Complete", endMonth: 3 },
  { name: "M1.2 Architectural and Functional Requirements Complete", endMonth: 6 },
  { name: "M1.3 Sub-Component Specification and Design Complete", endMonth: 12 },
  { name: "M1.4 System Implementation and Integration Complete", endMonth: 19 },
  { name: "M1.5 TRL5 Demonstrator Validated", endMonth: 24 },
];

// ---------------------------------------------------------------------------
// Logic helpers

// Slice a (startMonth, endMonth) range into N consecutive segments. Each
// task in a WP gets a narrower range than the WP itself — otherwise the
// roadmap shows every task spanning the full WP bar.
function sliceRange(startMonth, endMonth, n, i) {
  const span = endMonth - startMonth;
  const segment = span / n;
  return {
    startMonth: startMonth + segment * i,
    endMonth: startMonth + segment * (i + 1),
  };
}

// Where does this date range sit relative to the synthetic "today"?
//   "done"        — entirely in the past
//   "in_progress" — straddles today
//   "todo"        — entirely in the future
function statusFor(startMonth, endMonth) {
  if (endMonth <= CURRENT_MONTH) return "done";
  if (startMonth <= CURRENT_MONTH) return "in_progress";
  return "todo";
}

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
  // admin.auth.admin.listUsers() paginates (default 50 per page). On local
  // DBs that have accumulated test users from integration runs the target
  // user may live past page 1, so we have to walk pages until we find it
  // or run out.
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
  // FK CASCADE drops boards / lists / cards / milestones / board_members
  // in one shot.
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
  console.log(
    `  feature_flags ON: ${Object.entries(WORKSPACE_FEATURE_FLAGS)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ") || "(all off)"}`,
  );

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

  // Parent board: single neutral list. Anchor cards land here. No
  // status_kind, no Todo/In Progress/Done routing — roadmap renders
  // plain bars with title + dates.
  const [parentList] = await call("lists", {
    board_id: parentBoard.id,
    title: NEUTRAL_LIST_TITLE,
    position: "a000001",
  });

  // For each WP: an anchor card on the parent board + a sub-board linked
  // 1:1 via boards.parent_card_id (migration 0105). The roadmap's
  // groupBySubBoard reads sub-boards from the workspace snapshot and uses
  // each sub-board's anchor card as the lane header.
  positionCounter = 0;
  for (const wp of WORK_PACKAGES) {
    // 1. Anchor card on the parent board.
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

    // 2. Sub-board anchored to that card.
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

    const [subList] = await call("lists", {
      board_id: subBoard.id,
      title: NEUTRAL_LIST_TITLE,
      position: "a000001",
    });

    // Tasks — homed in the sub-board. They DON'T set parent_card_id to the
    // anchor card: the anchor lives on the parent board and migration
    // 0018's `cards_validate_parent` trigger enforces parent_card_id ↔
    // board_id co-location. The sub-board membership itself is the link
    // back to the anchor (boards.parent_card_id = anchorCard.id), which
    // `groupBySubBoard` reads to build the roadmap lane. Each task gets
    // its own date segment so the roadmap shows individual bars under the
    // anchor's lane.
    const taskRows = [];
    for (let i = 0; i < wp.tasks.length; i++) {
      const t = wp.tasks[i];
      const range = sliceRange(
        wp.startMonth,
        wp.endMonth,
        wp.tasks.length,
        i,
      );
      const taskStart = Math.round(range.startMonth);
      const taskEnd = Math.round(range.endMonth);
      const [row] = await call("cards", {
        list_id: subList.id,
        board_id: subBoard.id,
        title: t.title,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description: t.description,
        start_date: monthDateStr(taskStart),
        target_date: monthDateStr(taskEnd),
      });
      taskRows.push({ row, taskStart, taskEnd });
    }

    // Deliverables (type=subtask) — parented to their related task. Dates
    // copy the task's full range so the deliverable plots as a nested
    // subtask bar on the roadmap (without both dates it's listed as
    // "+1 UNDATED" and hidden until the parent is expanded).
    for (const d of wp.deliverables) {
      const parent = taskRows[d.underTaskIndex ?? 0];
      if (!parent)
        throw new Error(`${wp.code} ${d.code}: underTaskIndex out of bounds`);
      await call("cards", {
        list_id: subList.id,
        board_id: subBoard.id,
        title: d.title,
        position: nextPos(),
        type: "subtask",
        owner_id: null,
        parent_card_id: parent.row.id,
        description: d.description,
        start_date: monthDateStr(parent.taskStart),
        target_date: monthDateStr(parent.taskEnd),
      });
    }
  }

  // Plan milestones (date pins) ------------------------------------------
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
