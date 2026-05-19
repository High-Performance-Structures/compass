#!/usr/bin/env node
import Database from "better-sqlite3"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const NOW = new Date().toISOString()

const LOEFFLER_SOURCE_URL =
  "https://docs.google.com/spreadsheets/d/1bafgj7tRAG9rTKPnkO0fLSGtqU0bwOnhnxRQmP7TkEE"
const LOOMIS_SOURCE_URL =
  "https://drive.google.com/file/d/1GTKTKCBCScY6qE9OFxsJqnK6uX8avdh9/view"

function ensureBudgetTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_budget_applications (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      source_system text DEFAULT 'sage' NOT NULL,
      source_record_id text,
      application_number text NOT NULL,
      period_to text,
      status text DEFAULT 'current' NOT NULL,
      original_contract_sum real DEFAULT 0 NOT NULL,
      net_changes real DEFAULT 0 NOT NULL,
      contract_sum_to_date real DEFAULT 0 NOT NULL,
      total_completed_stored_to_date real DEFAULT 0 NOT NULL,
      retainage_held real DEFAULT 0 NOT NULL,
      total_earned_less_retainage real DEFAULT 0 NOT NULL,
      previous_certificates real DEFAULT 0 NOT NULL,
      current_payment_due real DEFAULT 0 NOT NULL,
      balance_to_finish real DEFAULT 0 NOT NULL,
      owner_visible integer DEFAULT false NOT NULL,
      source_url text,
      sync_status text DEFAULT 'synced' NOT NULL,
      last_synced_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_budget_lines (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      application_id text REFERENCES project_budget_applications(id) ON DELETE set null,
      source_system text DEFAULT 'sage' NOT NULL,
      source_record_id text,
      source_record_number text,
      cost_code text NOT NULL,
      csi_division text NOT NULL,
      csi_division_name text NOT NULL,
      description text NOT NULL,
      notes text,
      original_estimate real DEFAULT 0 NOT NULL,
      prior_changes real DEFAULT 0 NOT NULL,
      current_changes real DEFAULT 0 NOT NULL,
      total_changes real DEFAULT 0 NOT NULL,
      adjusted_estimate real DEFAULT 0 NOT NULL,
      prior_costs real DEFAULT 0 NOT NULL,
      current_costs real DEFAULT 0 NOT NULL,
      total_costs real DEFAULT 0 NOT NULL,
      percent_complete real DEFAULT 0 NOT NULL,
      balance_to_finish real DEFAULT 0 NOT NULL,
      retainage_held real DEFAULT 0 NOT NULL,
      vendor_name text,
      owner_label text,
      owner_visible integer DEFAULT false NOT NULL,
      internal_notes text,
      sort_order integer DEFAULT 0 NOT NULL,
      sync_status text DEFAULT 'synced' NOT NULL,
      last_synced_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_budget_applications_project
      ON project_budget_applications(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_budget_lines_project
      ON project_budget_lines(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_budget_lines_csi
      ON project_budget_lines(project_id, csi_division);
    CREATE INDEX IF NOT EXISTS idx_project_budget_lines_owner
      ON project_budget_lines(project_id, owner_visible);
  `)
}

function pct(total, adjusted) {
  if (!adjusted) return 0
  return Math.round((total / adjusted) * 1000) / 10
}

function line({
  projectId,
  appId,
  order,
  code,
  divisionName,
  original,
  priorChanges = 0,
  currentChanges = 0,
  priorCosts = 0,
  currentCosts = 0,
  ownerVisible = true,
  notes = null,
  internalNotes = null,
}) {
  const totalChanges = priorChanges + currentChanges
  const adjusted = original + totalChanges
  const totalCosts = priorCosts + currentCosts
  return {
    id: `budget-${projectId}-${code.slice(0, 2).toLowerCase()}-${order}`,
    projectId,
    applicationId: appId,
    sourceSystem: "sage_snapshot",
    sourceRecordId: `${projectId}:${code}`,
    sourceRecordNumber: code,
    costCode: code,
    csiDivision: code.slice(0, 2),
    csiDivisionName: divisionName,
    description: `${code} - ${divisionName}`,
    notes,
    originalEstimate: original,
    priorChanges,
    currentChanges,
    totalChanges,
    adjustedEstimate: adjusted,
    priorCosts,
    currentCosts,
    totalCosts,
    percentComplete: pct(totalCosts, adjusted),
    balanceToFinish: Math.max(0, adjusted - totalCosts),
    retainageHeld: 0,
    vendorName: null,
    ownerLabel: divisionName,
    ownerVisible,
    internalNotes,
    sortOrder: order,
  }
}

const budgets = [
  {
    projectId: "proj-o-202-loeffler",
    application: {
      id: "budget-app-proj-o-202-loeffler-current",
      sourceSystem: "sage_snapshot",
      sourceRecordId: "loeffler-g703-2026-05-22",
      applicationNumber: "4",
      periodTo: "2026-05-22",
      status: "current",
      originalContractSum: 1334145.55,
      netChanges: 17607.52,
      contractSumToDate: 1351753.07,
      totalCompletedStoredToDate: 541334.44,
      retainageHeld: 0,
      totalEarnedLessRetainage: 541334.44,
      previousCertificates: 541334.44,
      currentPaymentDue: 0,
      balanceToFinish: 810418.63,
      ownerVisible: 1,
      sourceUrl: LOEFFLER_SOURCE_URL,
    },
    lines: [
      line({
        projectId: "proj-o-202-loeffler",
        appId: "budget-app-proj-o-202-loeffler-current",
        order: 1,
        code: "00 00 00",
        divisionName: "Procurement Requirements",
        original: 6540,
        priorChanges: 119.35,
        priorCosts: 2637.38,
        notes: "Developer-folder G703 snapshot, pay app 4.",
      }),
      line({
        projectId: "proj-o-202-loeffler",
        appId: "budget-app-proj-o-202-loeffler-current",
        order: 2,
        code: "01 00 00",
        divisionName: "General Requirements",
        original: 100193.96,
        priorChanges: 1950.5,
        priorCosts: 26289.99,
      }),
      line({
        projectId: "proj-o-202-loeffler",
        appId: "budget-app-proj-o-202-loeffler-current",
        order: 3,
        code: "02 00 00",
        divisionName: "Existing Conditions",
        original: 1500,
      }),
      line({
        projectId: "proj-o-202-loeffler",
        appId: "budget-app-proj-o-202-loeffler-current",
        order: 4,
        code: "03 00 00",
        divisionName: "Concrete",
        original: 153561.41,
        priorChanges: 1461.17,
        priorCosts: 128482.92,
      }),
      line({
        projectId: "proj-o-202-loeffler",
        appId: "budget-app-proj-o-202-loeffler-current",
        order: 5,
        code: "06 00 00",
        divisionName: "Wood, Plastics, and Composites",
        original: 0,
        notes: "Awaiting Sage line sync for remaining current G703 detail.",
        ownerVisible: false,
        internalNotes: "Placeholder keeps internal users aware that the G703 snapshot is partial until Sage job-cost sync is live.",
      }),
    ],
  },
  {
    projectId: "proj-o-170-loomis",
    application: {
      id: "budget-app-proj-o-170-loomis-baseline",
      sourceSystem: "sage_snapshot",
      sourceRecordId: "loomis-csi-estimate-2025-11-25",
      applicationNumber: "Baseline",
      periodTo: "2025-11-25",
      status: "estimate",
      originalContractSum: 539291.87,
      netChanges: 0,
      contractSumToDate: 539291.87,
      totalCompletedStoredToDate: 0,
      retainageHeld: 0,
      totalEarnedLessRetainage: 0,
      previousCertificates: 0,
      currentPaymentDue: 0,
      balanceToFinish: 539291.87,
      ownerVisible: 1,
      sourceUrl: LOOMIS_SOURCE_URL,
    },
    lines: [
      ["00 00 00", "Procurement Requirements", 5175.04],
      ["01 00 00", "General Requirements", 74891.2],
      ["02 00 00", "Existing Conditions", 1000],
      ["03 00 00", "Concrete", 83538.45],
      ["04 00 00", "Masonry", 4000],
      ["05 00 00", "Metals", 1600],
      ["06 00 00", "Wood, Plastics, and Composites", 74071.32],
      ["07 00 00", "Thermal and Moisture Protection", 33080.59],
      ["08 00 00", "Openings", 15873.57],
      ["09 00 00", "Finishes", 88902.5],
      ["10 00 00", "Specialties", 7250],
      ["11 00 00", "Equipment", 550],
      ["12 00 00", "Furnishings", 4000],
      ["22 00 00", "Plumbing", 18286.74],
      ["23 00 00", "HVAC", 24000],
      ["26 00 00", "Electrical", 25275],
      ["27 00 00", "Communications", 1150],
      ["31 00 00", "Earthwork", 2267.53],
      ["32 00 00", "Exterior Improvements", 5501.11],
      ["33 00 00", "Utilities", 2650],
      ["99 00 00", "Company Overhead, Margin, and Contingency", 66228.83],
    ].map(([code, divisionName, original], index) =>
      line({
        projectId: "proj-o-170-loomis",
        appId: "budget-app-proj-o-170-loomis-baseline",
        order: index + 1,
        code,
        divisionName,
        original,
        notes: "CSI estimate baseline; actual Sage costs pending sync.",
      })
    ),
  },
]

function insertBudget(db, budget) {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(budget.projectId)
  if (!project) {
    throw new Error(`Project not found in local Compass DB: ${budget.projectId}`)
  }

  db.prepare("DELETE FROM project_budget_lines WHERE project_id = ?").run(
    budget.projectId
  )
  db.prepare("DELETE FROM project_budget_applications WHERE project_id = ?").run(
    budget.projectId
  )

  const app = budget.application
  db.prepare(`
    INSERT INTO project_budget_applications (
      id, project_id, source_system, source_record_id, application_number,
      period_to, status, original_contract_sum, net_changes,
      contract_sum_to_date, total_completed_stored_to_date, retainage_held,
      total_earned_less_retainage, previous_certificates, current_payment_due,
      balance_to_finish, owner_visible, source_url, sync_status,
      last_synced_at, created_at, updated_at
    ) VALUES (
      @id, @projectId, @sourceSystem, @sourceRecordId, @applicationNumber,
      @periodTo, @status, @originalContractSum, @netChanges,
      @contractSumToDate, @totalCompletedStoredToDate, @retainageHeld,
      @totalEarnedLessRetainage, @previousCertificates, @currentPaymentDue,
      @balanceToFinish, @ownerVisible, @sourceUrl, 'synced',
      @lastSyncedAt, @createdAt, @updatedAt
    )
  `).run({
    ...app,
    projectId: budget.projectId,
    lastSyncedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  })

  const insertLine = db.prepare(`
    INSERT INTO project_budget_lines (
      id, project_id, application_id, source_system, source_record_id,
      source_record_number, cost_code, csi_division, csi_division_name,
      description, notes, original_estimate, prior_changes, current_changes,
      total_changes, adjusted_estimate, prior_costs, current_costs,
      total_costs, percent_complete, balance_to_finish, retainage_held,
      vendor_name, owner_label, owner_visible, internal_notes, sort_order,
      sync_status, last_synced_at, created_at, updated_at
    ) VALUES (
      @id, @projectId, @applicationId, @sourceSystem, @sourceRecordId,
      @sourceRecordNumber, @costCode, @csiDivision, @csiDivisionName,
      @description, @notes, @originalEstimate, @priorChanges, @currentChanges,
      @totalChanges, @adjustedEstimate, @priorCosts, @currentCosts,
      @totalCosts, @percentComplete, @balanceToFinish, @retainageHeld,
      @vendorName, @ownerLabel, @ownerVisible, @internalNotes, @sortOrder,
      'synced', @lastSyncedAt, @createdAt, @updatedAt
    )
  `)

  for (const budgetLine of budget.lines) {
    insertLine.run({
      ...budgetLine,
      ownerVisible: budgetLine.ownerVisible ? 1 : 0,
      lastSyncedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  return {
    projectId: budget.projectId,
    application: app.applicationNumber,
    lineCount: budget.lines.length,
  }
}

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")
ensureBudgetTables(db)

const run = db.transaction(() => budgets.map((budget) => insertBudget(db, budget)))
const results = run()

console.log(JSON.stringify({ dbPath: DB_PATH, results }, null, 2))
