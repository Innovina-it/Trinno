#!/usr/bin/env node
// Seed an AIWEPI / Switch project workspace from the project plan PDF.
// 5 work packages (epics) + 11 tasks (stories) + 11 deliverables (subtasks)
// + 5 milestones (versions). Dates anchored to today as M1.
//
// Owner = aiwepi@local / password aiwepi-seed-2026 (created if missing).

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error("missing supabase env");

const admin = createClient(url, service, { auth: { persistSession: false } });
const browser = createClient(url, anon);

const EMAIL = "aiwepi@local";
const PASSWORD = "aiwepi-seed-2026";
const WORKSPACE_NAME = "AIWEPI - Switch";
const BOARD_TITLE = "AIWEPI - Piano di Progetto";

const DAY_MS = 86_400_000;
const today = new Date();
today.setHours(9, 0, 0, 0);
const monthStart = (m) => new Date(today.getTime() + (m - 1) * 30 * DAY_MS);

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

function frac(prev, next) {
  // Minimal fractional-indexing helper. We only ever append, so
  // generating "a0", "a1", "a2"... is enough. Sequential calls within a
  // list use string sort order.
  const c = String.fromCharCode(97 + (frac.i = (frac.i ?? -1) + 1));
  return `a${c}`;
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
    title: "WP1.1 — Analisi degli Scenari e Ambiti di Utilizzo",
    kind: "Ricerca Industriale",
    startMonth: 1, endMonth: 3,
    description:
      "Analisi degli scenari d'uso rilevanti come punto di partenza per progettazione e sviluppo della soluzione AIWEPI nel mercato emergente degli Intelligent Welding Systems (IWS), senza strumentazione nella maschera di saldatura.",
    tasks: [
      { code: "T1.1", title: "T1.1 Analisi del contesto operativo, scenari e casi d'uso" },
    ],
    deliverables: [
      { code: "D1.1.1", title: "D1.1.1 Contesto Applicativo, Stato dell'Arte e Scenari d'Uso" },
    ],
  },
  {
    code: "WP1.2",
    title: "WP1.2 — Definizione Requisiti Architetturali, Funzionali e Interoperabilità",
    kind: "Ricerca Industriale",
    startMonth: 3, endMonth: 6,
    description:
      "Modello di sviluppo iterativo/incrementale: piattaforma HW modulare + framework SW microservizi. Raccolta requisiti, baseline tecnologica HW/SW, stato dell'arte AI in saldatura industriale.",
    tasks: [
      { code: "T2.1", title: "T2.1 Ingegneria dei requisiti" },
      { code: "T2.2", title: "T2.2 Applicazioni dell'AI nella saldatura industriale, stato dell'arte" },
    ],
    deliverables: [
      { code: "D1.2.1", title: "D1.2.1 Requisiti Funzionali, Non-Funzionali e Tecnici" },
      { code: "D1.2.2", title: "D1.2.2 Applicazioni dell'AI nella Saldatura Industriale" },
    ],
  },
  {
    code: "WP1.3",
    title: "WP1.3 — Definizione Specifiche e Progettazione Sottocomponenti",
    kind: "Ricerca Industriale",
    startMonth: 6, endMonth: 12,
    description:
      "Specifiche e progettazione dei sottocomponenti AIWEPI, modello architetturale, modelli AI per detezione anomalie, UX complessiva, servizi tecnici e supporto utente finale.",
    tasks: [
      { code: "T3.1", title: "T3.1 Progettazione architettura AIWEPI" },
      { code: "T3.2", title: "T3.2 Progettazione algoritmi AI" },
      { code: "T3.3", title: "T3.3 Progettazione interfaccia uomo macchina" },
    ],
    deliverables: [
      { code: "D1.3.1", title: "D1.3.1 Progettazione Architettura Soluzione AIWEPI" },
      { code: "D1.3.2", title: "D1.3.2 Progettazione Algoritmi AI" },
      { code: "D1.3.3", title: "D1.3.3 Progettazione interfaccia uomo macchina" },
    ],
  },
  {
    code: "WP1.4",
    title: "WP1.4 — Realizzazione Sottocomponenti del Sistema e Integrazione",
    kind: "Sviluppo Sperimentale",
    startMonth: 11, endMonth: 19,
    description:
      "Implementazione incrementale dei sottocomponenti HW/SW (AIWEPI Smart Glove + Edge Computer), integrazione progressiva. Tre prototipi: Alfa (unit), Beta (integration), Finale (orchestrato).",
    tasks: [
      { code: "T4.1", title: "T4.1 Implementazione prototipo Alfa" },
      { code: "T4.2", title: "T4.2 Implementazione prototipo Beta" },
      { code: "T4.3", title: "T4.3 Implementazione prototipo Finale" },
    ],
    deliverables: [
      { code: "D1.4.1", title: "D1.4.1 Sottocomponenti AIWEPI: Prototipo Alfa" },
      { code: "D1.4.2", title: "D1.4.2 Sottocomponenti AIWEPI: Prototipo Beta" },
      { code: "D1.4.3", title: "D1.4.3 Sottocomponenti AIWEPI: Prototipo Finale" },
    ],
  },
  {
    code: "WP1.5",
    title: "WP1.5 — Realizzazione del Dimostratore Finale e Validazione (TRL5)",
    kind: "Sviluppo Sperimentale",
    startMonth: 19, endMonth: 24,
    description:
      "Integrazione incrementale dei sottocomponenti in un dimostratore finale stabile (TRL5), validato in scenari d'uso reali con saldatori e responsabili processo (Istituto Italiano di Saldatura coinvolto).",
    tasks: [
      { code: "T5.1", title: "T5.1 Integrazione e verifica del dimostratore finale" },
      { code: "T5.2", title: "T5.2 Validazione del dimostratore" },
    ],
    deliverables: [
      { code: "D1.5.1", title: "D1.5.1 Dimostratore Integrato AIWEPI" },
      { code: "D1.5.2", title: "D1.5.2 Validazione Dimostratore: Metodologia e Risultati" },
    ],
  },
];

const MILESTONES = [
  { code: "M1.1", title: "Completamento Analisi Mercato", endMonth: 3 },
  { code: "M1.2", title: "Completamento Requisiti Architetturali e Funzionali", endMonth: 6 },
  { code: "M1.3", title: "Completamento Definizione Specifiche e Progettazione Sottocomponenti", endMonth: 12 },
  { code: "M1.4", title: "Completamento Realizzazione del Sistema e Integrazione", endMonth: 19 },
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

  // Epics + tasks + deliverables
  let cardPos = 0;
  const nextPos = () => `a${(cardPos++).toString(36).padStart(3, "0")}`;

  for (const wp of WPS) {
    const [epic] = await call("cards", {
      list_id: lists.todo,
      board_id: board.id,
      title: wp.title,
      position: nextPos(),
    });
    await update("cards", epic.id, {
      type: "epic",
      description: `**${wp.kind}** · M${wp.startMonth}–M${wp.endMonth}\n\n${wp.description}`,
      start_date: monthStart(wp.startMonth).toISOString().slice(0, 10),
      target_date: monthStart(wp.endMonth).toISOString().slice(0, 10),
    });
    console.log(`Epic ${wp.code}: ${epic.id}`);

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
        parent_card_id: epic.id,
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
        parent_card_id: taskCards[0]?.id ?? epic.id,
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
