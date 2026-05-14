#!/usr/bin/env node
// Seed an AIWEPI / Switch project workspace from the project plan PDF.
// 5 work packages + 11 tasks (stories) + 11 deliverables (subtasks)
// + 5 milestones (versions). Dates anchored to PROJECT_START as M1.
//
// Owner = aiwepi@local / password aiwepi-seed-2026 (created if missing).

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) throw new Error("missing supabase env");

const admin = createClient(url, service, { auth: { persistSession: false } });

const EMAIL = "aiwepi@local";
const PASSWORD = "aiwepi-seed-2026";
const WORKSPACE_NAME = "AIWEPI - Switch";
const BOARD_TITLE = "AIWEPI - Project Plan";

const DAY_MS = 86_400_000;
const PROJECT_START = new Date('2025-10-15T09:00:00Z');
const monthStart = (m) => new Date(PROJECT_START.getTime() + (m - 1) * 30 * DAY_MS);

async function ensureUser() {
  const { data: list } = await admin.auth.admin.listUsers();
  let existing = list.users.find((u) => u.email === EMAIL);
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    existing = data.user;
    console.log(`Created user ${EMAIL}`);
  } else {
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  }
  return existing.id;
}

async function call(table, body) {
  const { data, error } = await admin.from(table).insert(body).select();
  if (error) throw new Error(`INSERT ${table}: ${error.message} ${JSON.stringify(body)}`);
  return data;
}

async function update(table, id, patch) {
  const { data, error } = await admin.from(table).update(patch).eq("id", id).select();
  if (error) throw new Error(`UPDATE ${table}: ${error.message}`);
  return data;
}

const STATUS_LISTS = [
  { title: "Backlog", statusKind: "todo" },
  { title: "In progress", statusKind: "in_progress" },
  { title: "Review", statusKind: "review" },
  { title: "Done", statusKind: "done" },
  { title: "Blocked", statusKind: "blocked" },
];

const WPS = [
  {
    code: "WP1.1",
    title: "WP1.1 — Scenario Analysis and Application Domains",
    kind: "Industrial Research",
    startMonth: 1, endMonth: 3,
    description:
      "Analysis of relevant use-case scenarios as the starting point for designing and developing the AIWEPI solution within the emerging Intelligent Welding Systems (IWS) market, targeting instrumentation-free welding helmet integration.",
    tasks: [
      {
        code: "T1.1",
        title: "T1.1 Operational Context Analysis, Scenarios and Use Cases",
        description: "Survey the operational environments where AIWEPI will be deployed, identifying key actors, workflows, and failure modes. Define representative use cases that will drive requirements and design decisions.",
      },
    ],
    deliverables: [
      {
        code: "D1.1.1",
        title: "D1.1.1 Application Context, State of the Art and Use Cases",
        description: "Structured document mapping the current welding-industry landscape, competitive technologies, and validated use-case scenarios that establish the scope and positioning of the AIWEPI system.",
      },
    ],
  },
  {
    code: "WP1.2",
    title: "WP1.2 — Definition of Architectural, Functional and Interoperability Requirements",
    kind: "Industrial Research",
    startMonth: 3, endMonth: 6,
    description:
      "Iterative/incremental development model covering a modular HW platform and a microservices SW framework. Includes requirements gathering, HW/SW technology baseline, and state-of-the-art review of AI in industrial welding.",
    tasks: [
      {
        code: "T2.1",
        title: "T2.1 Requirements Engineering",
        description: "Elicit, document, and baseline all functional, non-functional, and interoperability requirements through stakeholder workshops and analysis of the WP1.1 use cases. Produce a traceable requirements specification.",
      },
      {
        code: "T2.2",
        title: "T2.2 AI Applications in Industrial Welding — State of the Art",
        description: "Conduct a systematic literature and patent review covering AI-based anomaly detection, process monitoring, and quality control in industrial welding contexts. Identify gaps that AIWEPI is positioned to address.",
      },
    ],
    deliverables: [
      {
        code: "D1.2.1",
        title: "D1.2.1 Functional, Non-Functional and Technical Requirements",
        description: "Baseline requirements specification covering all functional capabilities, performance targets, safety constraints, and interoperability interfaces derived from stakeholder input and use-case analysis.",
      },
      {
        code: "D1.2.2",
        title: "D1.2.2 AI Applications in Industrial Welding",
        description: "State-of-the-art report reviewing existing AI techniques applied to weld process monitoring and quality assessment, benchmarking them against AIWEPI's target capabilities and identifying the innovation delta.",
      },
    ],
  },
  {
    code: "WP1.3",
    title: "WP1.3 — Sub-Component Specification and Design",
    kind: "Industrial Research",
    startMonth: 6, endMonth: 12,
    description:
      "Specification and design of all AIWEPI sub-components, covering the architectural model, AI models for anomaly detection, overall UX, technical services, and end-user support workflows.",
    tasks: [
      {
        code: "T3.1",
        title: "T3.1 AIWEPI Architecture Design",
        description: "Define the full architectural model for the AIWEPI system, including hardware topology, software layering, data flows between Smart Glove and Edge Computer, and integration interfaces with external systems.",
      },
      {
        code: "T3.2",
        title: "T3.2 AI Algorithm Design",
        description: "Design the machine-learning and signal-processing algorithms for real-time weld anomaly detection, specifying model architectures, training data requirements, inference latency targets, and update strategies.",
      },
      {
        code: "T3.3",
        title: "T3.3 Human-Machine Interface Design",
        description: "Design the HMI for welders and process supervisors, covering visual feedback, alert mechanisms, and accessibility constraints imposed by the welding-helmet form factor and industrial environment conditions.",
      },
    ],
    deliverables: [
      {
        code: "D1.3.1",
        title: "D1.3.1 AIWEPI Solution Architecture Design",
        description: "Detailed architecture design document specifying the hardware/software decomposition, communication protocols, data pipeline, and integration contracts for all AIWEPI sub-components.",
      },
      {
        code: "D1.3.2",
        title: "D1.3.2 AI Algorithm Design",
        description: "Design specification for the anomaly-detection and process-monitoring AI models, including dataset strategy, feature engineering approach, selected model families, and evaluation criteria.",
      },
      {
        code: "D1.3.3",
        title: "D1.3.3 Human-Machine Interface Design",
        description: "HMI design artefacts (wireframes, interaction flows, prototype mockups) for the welder-facing and supervisor-facing interfaces, validated against usability criteria for high-noise industrial environments.",
      },
    ],
  },
  {
    code: "WP1.4",
    title: "WP1.4 — Sub-Component Implementation and Integration",
    kind: "Experimental Development",
    startMonth: 11, endMonth: 19,
    description:
      "Incremental implementation of HW/SW sub-components (AIWEPI Smart Glove + Edge Computer) with progressive integration. Three prototype stages: Alpha (unit), Beta (integration), Final (orchestrated).",
    tasks: [
      {
        code: "T4.1",
        title: "T4.1 Alpha Prototype Implementation",
        description: "Implement and unit-test individual AIWEPI sub-components in isolation, covering firmware for the Smart Glove sensors and the initial edge-inference pipeline, producing the Alpha prototype artefacts.",
      },
      {
        code: "T4.2",
        title: "T4.2 Beta Prototype Implementation",
        description: "Integrate validated Alpha sub-components into a working Beta prototype, conducting integration testing across hardware-software boundaries and resolving inter-component interface issues.",
      },
      {
        code: "T4.3",
        title: "T4.3 Final Prototype Implementation",
        description: "Assemble and harden the full-system Final prototype from Beta-validated components, applying performance optimisations, reliability fixes, and end-to-end test campaigns in preparation for the demonstrator phase.",
      },
    ],
    deliverables: [
      {
        code: "D1.4.1",
        title: "D1.4.1 AIWEPI Sub-Components: Alpha Prototype",
        description: "Physical and software artefacts constituting the Alpha prototype, together with unit-test reports confirming each sub-component meets its individual specification.",
      },
      {
        code: "D1.4.2",
        title: "D1.4.2 AIWEPI Sub-Components: Beta Prototype",
        description: "Integrated Beta prototype artefacts and integration-test report documenting interface conformance, data flow correctness, and identified defects resolved before the Final prototype stage.",
      },
      {
        code: "D1.4.3",
        title: "D1.4.3 AIWEPI Sub-Components: Final Prototype",
        description: "Full-system Final prototype ready for demonstrator integration, accompanied by end-to-end test results, performance benchmarks, and a known-issues register with mitigations.",
      },
    ],
  },
  {
    code: "WP1.5",
    title: "WP1.5 — Final Demonstrator Integration and Validation (TRL5)",
    kind: "Experimental Development",
    startMonth: 19, endMonth: 24,
    description:
      "Incremental integration of sub-components into a stable final demonstrator (TRL5), validated in real-world use scenarios with welders and process managers, with the Istituto Italiano di Saldatura involved.",
    tasks: [
      {
        code: "T5.1",
        title: "T5.1 Final Demonstrator Integration and Verification",
        description: "Integrate all Final-prototype sub-components into the AIWEPI demonstrator system, execute system-level verification against the WP1.2 requirements baseline, and document residual non-conformances.",
      },
      {
        code: "T5.2",
        title: "T5.2 Demonstrator Validation",
        description: "Conduct structured validation trials with target end-users (welders and process supervisors) and the Istituto Italiano di Saldatura, measuring KPIs against TRL5 criteria and capturing user feedback.",
      },
    ],
    deliverables: [
      {
        code: "D1.5.1",
        title: "D1.5.1 AIWEPI Integrated Demonstrator",
        description: "Fully assembled AIWEPI demonstrator system integrating all HW and SW sub-components, with configuration documentation and a deployment guide for validation-site setup.",
      },
      {
        code: "D1.5.2",
        title: "D1.5.2 Demonstrator Validation: Methodology and Results",
        description: "Validation report detailing the trial methodology, quantitative performance results against TRL5 acceptance criteria, user-feedback analysis, and recommended next steps for exploitation.",
      },
    ],
  },
];

const MILESTONES = [
  { code: "M1.1", title: "Market Analysis Complete", endMonth: 3 },
  { code: "M1.2", title: "Architectural and Functional Requirements Complete", endMonth: 6 },
  { code: "M1.3", title: "Sub-Component Specification and Design Complete", endMonth: 12 },
  { code: "M1.4", title: "System Implementation and Integration Complete", endMonth: 19 },
  { code: "M1.5", title: "TRL5", endMonth: 24 },
];

async function seed() {
  const userId = await ensureUser();
  console.log(`User: ${userId}`);

  const [ws] = await call("workspaces", { name: WORKSPACE_NAME, owner_id: userId });
  console.log(`Workspace: ${ws.id}`);

  await call("workspace_members", {
    workspace_id: ws.id,
    user_id: userId,
    role: "owner",
  });

  const [board] = await call("boards", {
    workspace_id: ws.id,
    title: BOARD_TITLE,
    background_kind: "color",
    background_value: "#0f082a",
    visibility: "workspace",
    created_by: userId,
  });
  await call("board_members", {
    board_id: board.id,
    user_id: userId,
    role: "admin",
  });
  console.log(`Board: ${board.id}`);

  // Lists with status mapping
  const lists = {};
  for (const [i, l] of STATUS_LISTS.entries()) {
    const [row] = await call("lists", {
      board_id: board.id,
      title: l.title,
      position: `a${String.fromCharCode(97 + i)}`,
    });
    await update("lists", row.id, { status_kind: l.statusKind });
    lists[l.statusKind] = row.id;
  }
  console.log(`Lists: ${Object.keys(lists).join(", ")}`);

  // Versions = milestones
  const versions = {};
  for (const m of MILESTONES) {
    const [row] = await call("versions", {
      workspace_id: ws.id,
      name: `${m.code} ${m.title}`,
      description: `Milestone target: M${m.endMonth} (${monthStart(m.endMonth).toISOString().slice(0, 10)})`,
    });
    versions[m.code] = row.id;
  }
  console.log(`Versions: ${Object.keys(versions).length}`);

  // Work packages + tasks + deliverables
  let cardPos = 0;
  const nextPos = () => `a${(cardPos++).toString(36).padStart(3, "0")}`;

  for (const wp of WPS) {
    const [workPackage] = await call("cards", {
      list_id: lists.todo,
      board_id: board.id,
      title: wp.title,
      position: nextPos(),
    });
    await update("cards", workPackage.id, {
      type: "story",
      description: `**${wp.kind}** · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
      start_date: monthStart(wp.startMonth).toISOString().slice(0, 10),
      target_date: monthStart(wp.endMonth).toISOString().slice(0, 10),
    });
    console.log(`Work package ${wp.code}: ${workPackage.id}`);

    const taskCards = [];
    for (const t of wp.tasks) {
      const [card] = await call("cards", {
        list_id: lists.todo,
        board_id: board.id,
        title: t.title,
        position: nextPos(),
      });
      await update("cards", card.id, {
        type: "story",
        description: t.description,
        parent_card_id: workPackage.id,
        start_date: monthStart(wp.startMonth).toISOString().slice(0, 10),
        target_date: monthStart(wp.endMonth).toISOString().slice(0, 10),
      });
      taskCards.push(card);
    }

    for (const d of wp.deliverables) {
      const [card] = await call("cards", {
        list_id: lists.todo,
        board_id: board.id,
        title: d.title,
        position: nextPos(),
      });
      await update("cards", card.id, {
        type: "subtask",
        description: d.description,
        parent_card_id: taskCards[0]?.id ?? workPackage.id,
        target_date: monthStart(wp.endMonth).toISOString().slice(0, 10),
      });
    }
  }

  console.log(`\n✓ Done. Login: ${EMAIL} / ${PASSWORD}`);
  console.log(`  Workspace: http://192.168.68.58:3000/w/${ws.id}`);
  console.log(`  Board: http://192.168.68.58:3000/b/${board.id}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
