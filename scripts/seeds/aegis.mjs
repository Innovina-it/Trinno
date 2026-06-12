#!/usr/bin/env node
// AEGIS — Agricultural Earth-observation with Geospatial Intelligence and
// Sensing — project-plan seeder (anchor-card + sub-board format).
//
// Source: "Relazione tecnica dell'intervento proposto" (azione111ds_156843,
// Regione Liguria). Predictive olive-cascola monitoring: BIOSTOR biosensors,
// satellite imagery (Sentinel/Planet/Landsat), NB-IoT satellite connectivity,
// RTK UAVs and ML models behind a web-GIS decision-support platform.
// INNOVINA is capofila; partners AITRUST, DARTS, LOGOIL; research partners
// CNR-IMEM and CeRSAA. Project span: M1 = 1 Jan 2026 → M18 = 30 Jun 2027.
// The bando is in Italian; the seeded board/docs are in English (owner request).
//
// Logical structure (same machinery as swich-mars.mjs):
//   Workspace "AEGIS — Project Plan"
//   └─ Parent board "AEGIS · Project Plan"  (5 WP anchor cards + 5 plan milestones)
//      └─ 5 sub-boards, one per WP, each linked 1:1 to its anchor card via
//         boards.parent_card_id (migration 0105)
//         └─ each sub-board:
//            ├─ Tx.y task-cards (type=task)            ← dates = the WP span
//            └─ Dx.y deliverable-cards (type=subtask)  ← children of the most-related
//               task, dated at their due month. Each carries a yellow URL link
//               (card-scope `links` row, migration 0121) → its Google Doc.
//
// All cards are seeded unowned in Todo — a template the team self-assigns from.
//
// Run via ./scripts/seeds/run.sh — it handles env discovery, sensitive-flag
// prompts, and safety guards. Prod one-shot: scripts/seeds/seed-aegis-prod.sh.

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
const WORKSPACE_NAME = process.env.SEED_WORKSPACE || "AEGIS — Project Plan";
const PARENT_BOARD_TITLE = "AEGIS · Project Plan";
const SEED_RESET = process.env.SEED_RESET === "true";

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
  k === "RI"
    ? "Industrial Research (RI)"
    : k === "SS"
      ? "Experimental Development (SS)"
      : "Industrial Research + Experimental Development (RI+SS)";

// Per-deliverable URL link (card-scope `links` row, migration 0121). Yellow =
// LINK_COLORS[0] in lib/links/colors.ts. One link per deliverable card.
const PLACEHOLDER_LINK_COLOR = "#facc15";
// Fallback link when no Google service account is configured.
const PLACEHOLDER_LINK_URL = "https://www.corriere.it";

// --- Google Drive (optional) -----------------------------------------------
// When GOOGLE_SA_KEYFILE points at a service-account JSON key, the seed creates
// (or reuses) one Google Doc per deliverable and links each deliverable card to
// that doc instead of the placeholder. Drive layout:
//   <DRIVE_FOLDER_ID>/<WP title>/<Deliverables>/<deliverable doc>
// The SA must be a member of the (Shared Drive) folder with create rights.
const DRIVE_FOLDER_ID =
  process.env.AEGIS_DRIVE_FOLDER_ID || "1EG_IyL9YhqTKZmaoaGs1I-NGWX7KWbsf";
const DELIVERABLE_SUBFOLDER =
  process.env.AEGIS_DELIVERABLE_SUBFOLDER || "Deliverables";
const SA_KEYFILE = process.env.GOOGLE_SA_KEYFILE;
// Each deliverable doc starts from the project .docx template (AEGIS header,
// built by build-templates.py), gets its [DOCUMENT TITLE] and [Document
// subtitle] placeholders filled inside the .docx, and is uploaded via Drive
// with conversion to a native Google Doc. Drive API only — no Docs API.
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_DOCX = join(__dirname, "templates", "aegis.docx");

// Fill the title placeholders inside the .docx (a zip) before upload — the same
// zipfile surgery as build-templates.py. Both placeholders are contiguous
// strings in word/document.xml (verified against templates/aegis.docx).
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

  // Cache folder/doc lookups by `${parentId} ${name}` so the WP and
  // Deliverables folders are resolved once and reused across deliverables.
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
    // <folder>/<WP title>/<Deliverables>/<doc>  — each doc is a native Google
    // Doc converted from the project template (scripts/seeds/templates/aegis.docx),
    // with [DOCUMENT TITLE]/[Document subtitle] filled in the .docx pre-upload.
    async docUrlFor(wpName, docName, meta = {}) {
      const wpFolder = await findOrCreate(wpName, FOLDER_MIME, DRIVE_FOLDER_ID);
      const delFolder = await findOrCreate(
        DELIVERABLE_SUBFOLDER,
        FOLDER_MIME,
        wpFolder.id,
      );
      const subtitle =
        [meta.lead, meta.milestone].filter(Boolean).join(" · ") || wpName;
      const doc = await findOrCreate(docName, DOC_MIME, delFolder.id, () =>
        patchDocxTemplate(docName, subtitle),
      );
      return { url: doc.webViewLink, created: doc.created };
    },
  };
}

// ---------------------------------------------------------------------------
// Content — AEGIS. 5 WP · 20 tasks · 7 deliverables · 5 plan milestones.
// Dates are the WP table's real calendar dates (M1 = Jan 2026). Tasks have no
// per-task dates in the source, so each task spans its WP. Deliverables are
// embedded on the most topically-related task and dated at their due month.

const WORK_PACKAGES = [
  {
    code: "WP1",
    title: "WP1 — Requirements Analysis",
    kind: "RI",
    start: "2026-01-01",
    end: "2026-06-30",
    months: "M1–M6",
    description:
      "Foundational definition and analysis phase guiding the entire AEGIS development: translate the real needs of the Ligurian olive supply chain into precise, measurable technical specifications. Covers domain understanding (cascola triggers and dynamics as growers live them), user-centered definition (small/large olive growers, agronomists, researchers, consortia and their use cases), critical assessment of the available technologies (BIOSTOR biosensors, hyperspectral satellite imagery, NB-IoT connectivity, RTK drone systems) and a complete, unambiguous requirements document binding for design (WP2), development (WP3) and validation (WP4).",
    tasks: [
      {
        title: "T1.1 — State of the art & use cases in the olive sector",
        description:
          "Map current olive-grove management practices, focusing on water-stress and cascola mitigation strategies; review scientific literature and international best practice. In collaboration with CeRSAA and the Consorzio di Tutela dell'Olio DOP Riviera Ligure, run structured interviews and workshops with olive growers and agronomists to capture their direct needs, deriving the concrete use cases the platform must satisfy (e.g. \"as a grower, I want a geolocalized alert on my smartphone when a zone of my grove enters critical water stress\").",
      },
      {
        title: "T1.2 — Biosensor analysis & field-technology requirements",
        description:
          "Evaluation of the sensing technologies for in-field monitoring. Detailed analysis of CNR's BIOSTOR biosensor — integration, calibration and maintenance requirements for olive-specific use — plus complementary sensors (microclimate stations, soil-humidity sensors). Defines the communication-gateway technical specs with NB-IoT satellite technology for connectivity in rural areas, energy autonomy (battery duration), robustness (IP67) and the transmission protocols that assure data integrity.",
      },
      {
        title: "T1.3 — Satellite data state of the art & dataset definition",
        description:
          "Identification of the most suitable satellite data sources for the use case. Compares constellations (Sentinel, Planet, Landsat) on spatial, temporal and spectral resolution, with particular emphasis on hyperspectral and thermal data for their ability to capture early stress signals. Defines the most promising vegetation indices (NDVI, CWSI, PRI), the protocols for image acquisition and atmospheric correction, and the methodology for integrating ultra-high-resolution UAV acquisitions (optical sensors + RTK) for precision georeferencing and autonomous flight.",
      },
      {
        title: "T1.4 — Validation criteria & KPI definition",
        description:
          "Structured framework to measure project success objectively: quantitative metrics and Key Performance Indicators for every aspect of the solution. For the predictive model: accuracy KPIs (e.g. >85% stress-state classification accuracy), precision and alert lead time. For the platform: technical KPIs (e.g. end-to-end latency <5 minutes) and usability KPIs (e.g. task completion <1 minute). Plus agronomic and economic impact KPIs (e.g. % reduction of losses, farm ROI) that will guide the final validation in WP4.",
      },
    ],
    deliverables: [
      {
        title: "D1.1 — Requirements, Use Cases & KPI",
        taskIndex: 3,
        due: "2026-06-30",
        month: 6,
        description:
          "The complete, validated baseline document for the entire project: detailed state-of-the-art analysis, the full map of use cases and user stories, detailed technical specifications for the hardware (sensors, gateway) and software components, and the requirements for satellite data and analysis methodologies.",
      },
    ],
  },
  {
    code: "WP2",
    title: "WP2 — AEGIS Platform Architecture Definition",
    kind: "RI",
    start: "2026-04-01",
    end: "2026-10-31",
    months: "M4–M10",
    description:
      "Crucial design phase translating WP1's functional and scientific requirements into a detailed, feasible and scalable technical architecture — the complete blueprint of the AEGIS system. Designs a resilient distributed edge+cloud architecture able to manage heterogeneous real-time data flows (point sensor data, satellite raster imagery) with high availability and data integrity; user-centered interfaces and workflows for olive growers and agronomists; a modular open-standard system for future expansion and integration; and the data architecture plus compute infrastructure needed to develop, train and run performant, scientifically valid predictive AI.",
    tasks: [
      {
        title: "T2.1 — High-level architecture & platform components",
        description:
          "Defines the overall microservices-based system architecture for flexibility and scalability. Designs the main logical components — the data-ingestion layer (sensors and satellites), the processing engine, the AI module, the storage system and the API data-exposure layer — specifies the interconnections and communication protocols (e.g. MQTT for IoT, RESTful APIs for web services) and designs the security architecture with end-to-end data encryption.",
      },
      {
        title: "T2.2 — Hardware & firmware analysis and design",
        description:
          "Designs the hardware ecosystem to deploy in the field: a rugged IP67 housing for the BIOSTOR biosensors and the microclimate sensors, and the edge gateway responsible for data collection. Defines the firmware architecture with a focus on power management to maximize the autonomy of battery-powered devices, and specifies the communication protocols for data transmission via NB-IoT satellite technology, guaranteeing connectivity in uncovered rural areas.",
      },
      {
        title: "T2.3 — Software platform, user dashboard & KPI reporting design",
        description:
          "User-experience design (UX/UI) of the platform: the web-GIS dashboard defining how users visualize their groves, historical and real-time data, and the risk maps. Designs the alert-management workflows with a multi-channel notification system. The design is user-centered, based on the WP1 stakeholder feedback (including the Consorzio di Tutela dell'Olio DOP) to ensure the platform is a practical, easy-to-use tool.",
      },
      {
        title: "T2.4 — Analysis & prediction (AI) algorithm design",
        description:
          "Designs the entire Artificial Intelligence pipeline: methodologies for satellite-image pre-processing and vegetation-index extraction; the machine-learning model architecture correlating remotely sensed data with the BIOSTOR \"ground truth\"; and the framework for model training, validation and deployment, including a prediction-uncertainty quantification system — fundamental for giving the end user trustworthy information.",
      },
      {
        title: "T2.5 — Field data-acquisition methodologies (fixed sensors & UAV)",
        description:
          "Defines the operational protocols for data collection. In collaboration with CeRSAA and CNR, establishes the standard procedures for installing and calibrating the biosensors and weather stations in the pilot olive groves, and the methodologies for UAV (RTK-equipped) acquisition campaigns — flight plans, timing and sensors — to guarantee ultra-high-precision data supporting the evaluation of water-need and physiopathological parameters.",
      },
    ],
    deliverables: [
      {
        title: "D2.1 — Platform Architecture Document",
        taskIndex: 0,
        due: "2026-07-31",
        month: 7,
        description:
          "Initial document defining the overall architectural vision of the AEGIS system: the description of the macro logical components (e.g. Data Ingestion, Processing, AI Module, Storage, API), the main data flows and the candidate technologies for each block — a strategic map for the subsequent detailed design.",
      },
      {
        title: "D2.2 — Final Analysis & Design Report",
        taskIndex: 2,
        due: "2026-10-31",
        month: 10,
        description:
          "The main, final result of WP2: the complete architectural blueprint (detailed description of every technological component, interfaces, protocols and deployment strategies), the user-centered design system (validated prototypes and wireframes ready for implementation), the scalable data architecture, and the complete AI/ML framework for developing, training and deploying the predictive models. The foundation for WP3.",
      },
    ],
  },
  {
    code: "WP3",
    title: "WP3 — Analysis Methodologies & Solution Development",
    kind: "SS",
    start: "2026-07-01",
    end: "2027-02-28",
    months: "M7–M14",
    description:
      "The operational and implementation core of AEGIS: the specifications and architecture defined in the previous WPs are translated into working software, AI algorithms and functioning hardware components — a complete, testable, demonstrable prototype. Implements the predictive ML model correlating field-collected physiological data with satellite imagery (target accuracy >85%, useful lead time of 7–14 days), the full microservices software platform with the web-GIS dashboard, and the complete hardware/software IoT ecosystem (BIOSTOR biosensors, microclimate sensors, NB-IoT gateways), with continuous scientific validation alongside the research partners (CNR, CeRSAA).",
    tasks: [
      {
        title: "T3.1 — Predictive algorithms & satellite-image correlation",
        description:
          "Implements the machine-learning models for plant-stress and cascola-risk prediction. Builds the satellite acquisition and automatic pre-processing pipelines (including atmospheric correction), the algorithms extracting specialized vegetation features and indices (NDVI, PRI, CWSI, etc.), and trains the models (e.g. Neural Networks, Random Forest) to correlate the remotely sensed data with the \"ground truth\" provided by the BIOSTOR biosensors and weather stations. Goal: a model that, once trained, infers plant stress mainly from satellite imagery, with quantified result uncertainty.",
      },
      {
        title: "T3.2 — User interface development",
        description:
          "Complete implementation of the AEGIS user interface per the WP2 designs: a responsive, interactive web-GIS dashboard where olive growers visualize their parcels on a map, consult historical and real-time sensor data and, above all, see the risk maps generated by the AI model. Implements the intelligent alerting system notifying users promptly when risk thresholds are crossed. User-centered, involving end users for maximum usability and clarity.",
      },
      {
        title: "T3.3 — Hardware components & firmware development",
        description:
          "Physical realization of the IoT devices to install in the field: engineering of the BIOSTOR biosensors into a rugged housing (IP67 protection) and development of the edge gateway for data collection. Develops and tests the device firmware with particular focus on low-power management to maximize field battery duration, implementing resilient communication protocols for data transmission via NB-IoT satellite technology.",
      },
      {
        title: "T3.4 — Data-management system development",
        description:
          "Implements the backend infrastructure managing the entire data life cycle: ETL ingestion pipelines to acquire, validate and harmonize heterogeneous data (sensor time series, geospatial satellite raster, vector data — with an appropriate dedicated methodology for non-continuous UAV raster data); a scalable data lake for efficient raw-data archiving plus a structured database for processed data; secure REST APIs for the user interface and other services; and monitoring systems guaranteeing data quality and integrity.",
      },
    ],
    deliverables: [
      {
        title: "D3.1 — Functioning Technological Components",
        taskIndex: 0,
        due: "2027-02-28",
        month: 14,
        description:
          "The individual, disjoint, functioning technological components: the working predictive system (AI algorithms developed, trained and tested on real data, with measurable, scientifically validated performance), the complete first version of the AEGIS software platform (dashboard, API and backend services operational), the validated nb-IoT/IoT hardware (sensor and gateway prototypes lab-tested and ready for field installation and long-term validation), and the integrated, scalable data platform for ingestion, processing, archiving and analysis.",
      },
    ],
  },
  {
    code: "WP4",
    title: "WP4 — Integration & Test",
    kind: "SS",
    start: "2027-01-01",
    end: "2027-06-30",
    months: "M13–M18",
    description:
      "The culminating consolidation and field-validation phase: all hardware and software components developed and individually tested in WP3 are assembled into one unified system and subjected to a rigorous testing cycle in real operating conditions. Demonstrates that the AEGIS platform works as an integrated system and is effective, reliable and fully compliant with the scientific and functional requirements defined in WP1 — end-to-end integration (biosensors → NB-IoT/satellite transmission → cloud processing → AI models → web-GIS dashboard), quantitative KPI verification, robustness/stress testing (connectivity loss, anomalous sensor data) and controlled field experimentation with the research partners (CNR, CeRSAA) comparing the AI model's predictions with the ground truth.",
    tasks: [
      {
        title: "T4.1 — Platform component integration",
        description:
          "Technical assembly of all software, hardware and AI modules into an end-to-end data flow: from BIOSTOR and weather-station signal capture, through NB-IoT/satellite gateway transmission, to reception and storage in the cloud data-management system. Integrates the processing pipelines feeding the predictive algorithms with raw data and satellite imagery, and wires the model outputs (risk maps, alerts) to the microservices exposing them on the user dashboard. Includes systematic debugging and performance tuning to optimize the latency and throughput of the whole system.",
      },
      {
        title: "T4.2 — Technological & functional prototype validation",
        description:
          "Systematic tests verifying the integrated prototype's full conformity to the functional and non-functional specifications defined in WP1: functional tests on every expected use scenario (e.g. registering a new grove, viewing historical data, receiving an alert), load tests validating platform scalability by simulating simultaneous data acquisition from all available sensors, and usability tests with a pilot group of olive growers — in collaboration with the Consorzio di Tutela — to validate the user experience and gather direct feedback on the dashboard's intuitiveness and the clarity of the presented information.",
      },
      {
        title: "T4.3 — Analysis-algorithm validation",
        description:
          "Rigorous scientific validation of the AI algorithms' predictive efficacy. In collaboration with CNR-IMEM and CeRSAA, the predictive models' results (based on satellite data) are systematically compared with the field-collected \"ground truth\" — direct BIOSTOR measurements and the agronomists' phenological observations — using standard statistical metrics (accuracy, precision, F1-score) on extended datasets covering different olive varieties and the diverse pedoclimatic conditions of the pilot groves, to test the algorithms' robustness and generalizability.",
      },
      {
        title: "T4.4 — Complete-solution test & validation",
        description:
          "Integrated testing of the complete system in a real operating environment, demonstrating efficacy and value in a realistic usage scenario: the AEGIS prototype is installed and continuously monitored on pilot olive groves for at least one full olive season, evaluating behaviour across phenological phases and environmental conditions. Long-term hardware reliability tests in the field (resistance to weather agents, battery duration) and evaluation of the solution's operational impact, gathering qualitative and quantitative data on how the system's alerts supported the involved growers' agronomic decisions.",
      },
    ],
    deliverables: [
      {
        title: "D4.1 — Integrated Working AEGIS Prototype",
        taskIndex: 0,
        due: "2027-06-30",
        month: 18,
        description:
          "A complete end-to-end system, tested and validated in all its components — from the sensor to the dashboard. Accompanied by the Performance Validation Report certifying the achievement of the technical and functional KPIs with objective evidence collected during testing, and by documented positive feedback from the pilot olive growers with case studies demonstrating the platform's practical value in day-to-day grove management.",
      },
    ],
  },
  {
    code: "WP5",
    title: "WP5 — Project Management, Dissemination & Exploitation",
    kind: "RI+SS",
    lead: "INNOVINA",
    start: "2026-01-01",
    end: "2027-06-30",
    months: "M1–M18",
    description:
      "The organizational and strategic backbone across the project's entire life cycle, guaranteeing success through effective coordination, proactive risk management and clear exploitation planning. Led by INNOVINA as capofila with a dedicated Project Manager, structured governance, periodic monitoring meetings and a collaborative platform for real-time documentation sharing. Mitigates the key risks: hardware/software procurement delays (alternative suppliers, anticipated purchasing for critical components), farm resistance to digital adoption (field demonstrations and awareness actions with CeRSAA and the Consorzio DOP), and post-project commercial scalability (industrialization roadmap and complementary funding — e.g. Horizon Europe and PSR calls).",
    tasks: [
      {
        title: "T5.1 — Project management",
        description:
          "Coordinated by capofila INNOVINA: detailed planning of all WP activities with constant milestone and deliverable monitoring through advanced project-management tools; a proactive risk-management system identifying and periodically evaluating potential technical, scientific and operational obstacles with mitigation strategies; partner communication (INNOVINA, CNR, CeRSAA and the other companies) via periodic alignment meetings and collaborative platforms; and financial monitoring for budget control and periodic reporting to the funding body.",
      },
      {
        title: "T5.2 — Exploitation plan & market roadmap",
        description:
          "Translates the research results into a concrete business opportunity: in-depth market analysis defining the priority target segments (specialized olive farms, protection consortia, large producers) and validating product-market fit; a detailed business model — likely subscription-based (SaaS) with a clear pricing strategy; a go-to-market strategy including sales channels and strategic partnerships with agritech players; an IP strategy for the intellectual property generated (notably the predictive algorithms and the platform architecture); all converging into a complete business plan with financial projections and a national/European scaling roadmap.",
      },
      {
        title: "T5.3 — Communication & dissemination",
        description:
          "Maximizes the visibility, impact and adoption of the AEGIS results across different audiences: scientific publications in international agronomy and remote-sensing journals with the research partners (CNR, CeRSAA) plus sector-conference participation; demonstrative workshops and field days for olive-sector stakeholders, organized with CeRSAA and the Consorzio di Tutela dell'Olio DOP, playing a key role in technology transfer; a dedicated website, multimedia content and case studies on the first applicative results; targeted training to facilitate adoption by farms and the creation of an active user and stakeholder community.",
      },
    ],
    deliverables: [
      {
        title: "D5.1 — Mid-Term Review Document",
        taskIndex: 0,
        due: "2026-09-30",
        month: 9,
        description:
          "Intermediate report attesting the project's progress at mid-course: verification of the achievement of the planned milestones, alignment with the objectives and budget management.",
      },
      {
        title: "D5.2 — Closure Report, KPI Verification & Exploitation Plan",
        taskIndex: 1,
        due: "2027-06-30",
        month: 18,
        description:
          "Final document summarizing the overall results, certifying the achievement of the defined Key Performance Indicators and presenting the commercial and scientific exploitation plan for the obtained results.",
      },
    ],
  },
];

// Plan milestones (date pins on the master roadmap). The source has no explicit
// milestone table — these are derived from the WP end dates and the named
// mid-term/closure deliverables.
const MILESTONES = [
  {
    name: "M6 — Requirements Baseline",
    date: "2026-06-30",
    description:
      "WP1 complete: validated requirements, use cases and KPI framework — the authoritative baseline for the entire project. Deliverable: D1.1.",
  },
  {
    name: "M9 — Mid-Term Review",
    date: "2026-09-30",
    description:
      "Project mid-course checkpoint: milestone achievement, alignment with objectives and budget management. Deliverable: D5.1.",
  },
  {
    name: "M10 — Architecture Complete",
    date: "2026-10-31",
    description:
      "WP2 complete: full architectural blueprint, user-centered design system, scalable data architecture and AI/ML framework. Deliverables: D2.1, D2.2.",
  },
  {
    name: "M14 — Components Developed",
    date: "2027-02-28",
    description:
      "WP3 complete: predictive system, software platform, validated nb-IoT hardware and data platform — functioning individually. Deliverable: D3.1.",
  },
  {
    name: "M18 — Integrated Prototype & Closure",
    date: "2027-06-30",
    description:
      "WP4/WP5 complete: end-to-end validated AEGIS prototype (TRL 6), KPI verification and exploitation plan. Deliverables: D4.1, D5.2.",
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
  console.log("Span: M1 2026-01-01 → M18 2027-06-30 (18 months)");

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
  for (const wp of WORK_PACKAGES) {
    // 1. WP anchor card on the parent board.
    const lead = wp.lead ? ` · Leader ${wp.lead}` : "";
    const [anchorCard] = await call("cards", {
      list_id: parentTodoList,
      board_id: parentBoard.id,
      title: wp.title,
      position: nextPos(),
      type: "task",
      owner_id: null,
      description:
        `**Work Package** · ${kindLabel(wp.kind)}${lead} · ${wp.months}\n\n${wp.description}`,
      start_date: wp.start,
      target_date: wp.end,
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

    // 3. Task cards in the sub-board. The source gives no per-task dates, so
    // each task spans its WP.
    const taskCards = [];
    for (const t of wp.tasks) {
      const [taskCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: t.title,
        position: nextPos(),
        type: "task",
        owner_id: null,
        description:
          `**${kindLabel(wp.kind)}** · ${wp.months}\n\n${t.description}`,
        start_date: wp.start,
        target_date: wp.end,
      });
      taskCards.push(taskCard);
      taskCount += 1;
    }

    // 4. Deliverable subtasks parented to their most-related task, dated at
    // their due month.
    for (const d of wp.deliverables) {
      const parentTask = taskCards[d.taskIndex];
      const startOfDueMonth = `${d.due.slice(0, 8)}01`;
      const [delCard] = await call("cards", {
        list_id: subTodoList,
        board_id: subBoard.id,
        title: d.title,
        position: nextPos(),
        type: "subtask",
        owner_id: null,
        parent_card_id: parentTask.id,
        description: `**Deliverable** · ${wp.code} · M${d.month}\n\n${d.description}`,
        start_date: startOfDueMonth,
        target_date: d.due,
      });
      delCount += 1;

      // Link URL: a real Google Doc (created/reused under <WP>/Deliverables/)
      // when a service account is configured, else the placeholder. The doc
      // is named after the deliverable title (e.g. "D1.1 — …").
      let linkUrl = PLACEHOLDER_LINK_URL;
      if (drive) {
        const doc = await drive.docUrlFor(wp.title, d.title, {
          lead: wp.code,
          milestone: `M${d.month}`,
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

    console.log(
      `  ${wp.code}: anchor ${anchorCard.id}, sub-board ${subBoard.id}, ${wp.tasks.length} tasks, ${wp.deliverables.length} deliverables`,
    );
  }

  // Plan milestones (date pins on the master roadmap) ----------------------
  for (const m of MILESTONES) {
    await call("milestones", {
      workspace_id: ws.id,
      board_id: parentBoard.id,
      name: m.name,
      date: `${m.date}T12:00:00Z`,
      description: m.description,
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
