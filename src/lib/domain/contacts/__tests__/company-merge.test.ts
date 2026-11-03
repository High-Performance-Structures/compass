import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { beforeEach, describe, expect, it } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import {
  companyMergeRepairStatements,
  companyMergeStatements,
  inspectCompanyMerge,
  planTradeDocMerge,
} from "@/lib/domain/contacts/company-merge"
import { isRecord } from "@/lib/shared/guards"

import { buildRepairPlan, MAX_BATCH_VALUES } from "../../../../../scripts/repair-company-merge.mjs"

/*
 * Company merges run against a database built from every migration, so the
 * moves, guards and collision rules run exactly as D1 would run them.
 * Regression: merging "Guaranteed Caulking" into "Guaranteed Caulking Inc"
 * left the trade docs on the hidden archived vendor.
 */

type Sqlite = InstanceType<typeof Database>
type Row = Record<string, unknown>

const ORG = "org-1"
const OTHER_ORG = "org-2"
const NOW = "2026-11-01T12:00:00.000Z"
const T0 = "2026-01-01T00:00:00.000Z"
const SOURCE = "vendor-gc"
const KEEP = "vendor-gc-inc"

function isD1(value: unknown): value is D1Database {
  return isRecord(value) && typeof value.prepare === "function" && typeof value.batch === "function"
}

function migrated(): { readonly sqlite: Sqlite; readonly d1: D1Database } {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  const d1 = d1Over(sqlite)
  if (!isD1(d1)) throw new Error("Not a D1 stand-in")
  return { sqlite, d1 }
}

function insert(sqlite: Sqlite, table: string, row: Row): void {
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => row[column]))
}

function all(sqlite: Sqlite, query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

function value(sqlite: Sqlite, query: string, ...binds: readonly unknown[]): unknown {
  const [row] = all(sqlite, query, ...binds)
  return row ? Object.values(row)[0] : undefined
}

function seedBase(sqlite: Sqlite): void {
  for (const id of [ORG, OTHER_ORG]) {
    insert(sqlite, "organizations", { id, name: id, slug: id, type: "internal", is_active: 1, created_at: T0, updated_at: T0 })
  }
  insert(sqlite, "users", { id: "user-1", email: "pm@example.com", role: "admin", is_active: 1, created_at: T0, updated_at: T0 })
  insert(sqlite, "projects", { id: "project-1", name: "Job", organization_id: ORG, created_at: T0 })
}

function vendor(sqlite: Sqlite, id: string, name: string, extra: Row = {}): void {
  insert(sqlite, "vendors", { id, name, organization_id: ORG, created_at: T0, updated_at: T0, ...extra })
}

function tradeDoc(sqlite: Sqlite, id: string, vendorId: string, docType: string, driveFileId: string | null, supersededAt: string | null = null): void {
  insert(sqlite, "vendor_trade_documents", {
    id, organization_id: ORG, vendor_id: vendorId, doc_type: docType, drive_file_id: driveFileId,
    superseded_at: supersededAt, created_by_name: "Staff", created_at: T0, updated_at: T0,
  })
}

function seedVendorReferences(sqlite: Sqlite): void {
  vendor(sqlite, SOURCE, "Guaranteed Caulking", { trade_docs_folder_id: "folder-gc", trade_docs_bill_mode: "warn" })
  vendor(sqlite, KEEP, "Guaranteed Caulking Inc", { sage_vendor_id: "sage-guid", sage_vendor_number: "GC100" })
  vendor(sqlite, "vendor-older-dup", "G. Caulking", { merged_into_vendor_id: SOURCE, directory_status: "merged" })
  insert(sqlite, "vendor_contacts", { id: "person-1", vendor_id: SOURCE, name: "Pat", created_at: T0, updated_at: T0 })
  insert(sqlite, "project_contacts", {
    id: "pc-1", project_id: "project-1", contact_type: "subcontractor", display_name: "Guaranteed Caulking",
    vendor_id: SOURCE, source_entity_type: "vendor", source_entity_id: SOURCE, created_at: T0, updated_at: T0,
  })
  // Trade docs: a plain move, a type both have current (kept vendor wins), and the same Drive file on both.
  tradeDoc(sqlite, "doc-w9", SOURCE, "w9", "file-w9")
  tradeDoc(sqlite, "doc-coi-old", SOURCE, "coi", "file-coi-old")
  tradeDoc(sqlite, "keep-coi", KEEP, "coi", "file-coi-keep")
  tradeDoc(sqlite, "doc-license", SOURCE, "license", "file-license")
  tradeDoc(sqlite, "keep-license-old", KEEP, "license", "file-license", "2026-06-01T00:00:00.000Z")
  insert(sqlite, "vendor_trade_doc_links", {
    id: "link-1", organization_id: ORG, vendor_id: SOURCE, token_hash: "hash-1", recipient_email: "pat@example.com",
    requested_json: "[\"coi\"]", expires_at: "2026-12-01T00:00:00.000Z", created_by_name: "Staff", created_at: T0,
  })
  insert(sqlite, "project_operations", {
    id: "po-1", project_id: "project-1", source_record_type: "purchase_order", title: "PO 1", vendor_id: SOURCE, created_at: T0, updated_at: T0,
  })
  insert(sqlite, "project_operations", {
    id: "po-2", project_id: "project-1", source_record_type: "purchase_order", title: "PO 2", vendor_id: SOURCE,
    sage_vendor_id: "GC100", created_at: T0, updated_at: T0,
  })
  insert(sqlite, "project_budget_lines", {
    id: "budget-1", project_id: "project-1", cost_code: "07-900", csi_division: "07", csi_division_name: "Thermal",
    description: "Caulking", vendor_id: SOURCE, created_at: T0, updated_at: T0,
  })
  insert(sqlite, "project_warranty_claims", {
    id: "claim-1", organization_id: ORG, project_id: "project-1", claim_number: "W-1", title: "Leak", category: "exterior",
    description: "Leak", claimant_name: "Owner", assigned_vendor_id: SOURCE, submitted_at: T0, created_at: T0, updated_at: T0,
  })
  insert(sqlite, "vendor_bills", { id: "bill-1", vendor_id: SOURCE, bill_date: "2026-02-01", created_at: T0, updated_at: T0 })
  insert(sqlite, "payments", { id: "pay-1", vendor_id: SOURCE, payment_type: "vendor", amount: 100, payment_date: "2026-02-02", created_at: T0, updated_at: T0 })
  insert(sqlite, "email_reply_threads", {
    id: "thread-1", token: "tok-1", organization_id: ORG, source_type: "vendor", source_id: SOURCE,
    reply_to_address: "reply@example.com", subject: "Trade docs", created_at: T0, updated_at: T0,
  })
  insert(sqlite, "activity_events", {
    id: "activity-1", organization_id: ORG, actor_name: "Staff", actor_role: "admin", category: "email",
    action: "trade_docs_emailed", entity_type: "vendor", entity_id: SOURCE, summary: "Requested docs", created_at: T0,
  })
}

function vendorMerge(d1: D1Database): D1PreparedStatement[] {
  return companyMergeStatements(d1, {
    kind: "vendor_company", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP,
    sourceSnapshot: "{}", destinationSnapshot: "{}", peopleCount: 1, projectContactCount: 1, userId: "user-1", now: NOW,
  })
}

function vendorIdOf(sqlite: Sqlite, table: string, id: string, column = "vendor_id"): unknown {
  return value(sqlite, `SELECT ${column} FROM ${table} WHERE id = ?`, id)
}

describe("vendor company merge", () => {
  let sqlite: Sqlite
  let d1: D1Database

  beforeEach(() => {
    ;({ sqlite, d1 } = migrated())
    seedBase(sqlite)
    seedVendorReferences(sqlite)
  })

  it("previews every category that moves, with trade-doc collisions spelled out", async () => {
    const details = await inspectCompanyMerge(d1, { side: "vendor", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP })
    expect(details.blockers).toEqual([])
    const counts = Object.fromEntries(details.moves.map((move) => [move.category, move.count]))
    expect(counts).toMatchObject({
      people: 1, project_contacts: 1, trade_docs: 3, trade_doc_requests: 1, purchase_orders: 2, budget_lines: 1,
      warranty: 1, bills_payments: 2, email_threads: 1, activity: 1, merged_records: 1,
    })
    expect(details.tradeDocs).toEqual({
      moved: ["doc-coi-old", "doc-w9"],
      becomeHistory: ["doc-coi-old"],
      keptOnArchive: ["doc-license"],
      restoredOnKept: ["keep-license-old"],
    })
    expect(details.warnings.join(" ")).toContain("move as history")
    expect(details.warnings.join(" ")).toContain("same Drive file")
  })

  it("moves every reference in one batch and archives the source last", async () => {
    await d1.batch(vendorMerge(d1))

    expect(vendorIdOf(sqlite, "vendor_contacts", "person-1")).toBe(KEEP)
    expect(all(sqlite, "SELECT vendor_id, source_entity_id FROM project_contacts WHERE id = 'pc-1'")).toEqual([{ vendor_id: KEEP, source_entity_id: KEEP }])
    expect(vendorIdOf(sqlite, "vendor_trade_doc_links", "link-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_operations", "po-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_operations", "po-2")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_budget_lines", "budget-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_warranty_claims", "claim-1", "assigned_vendor_id")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "vendor_bills", "bill-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "payments", "pay-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "email_reply_threads", "thread-1", "source_id")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "activity_events", "activity-1", "entity_id")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "vendors", "vendor-older-dup", "merged_into_vendor_id")).toBe(KEEP)

    // Trade docs: one current document per type, nothing deleted.
    const docs = all(sqlite, "SELECT id, vendor_id, doc_type, superseded_at FROM vendor_trade_documents ORDER BY id")
    expect(docs).toEqual([
      { id: "doc-coi-old", vendor_id: KEEP, doc_type: "coi", superseded_at: NOW },
      { id: "doc-license", vendor_id: SOURCE, doc_type: "license", superseded_at: NOW },
      { id: "doc-w9", vendor_id: KEEP, doc_type: "w9", superseded_at: null },
      { id: "keep-coi", vendor_id: KEEP, doc_type: "coi", superseded_at: null },
      { id: "keep-license-old", vendor_id: KEEP, doc_type: "license", superseded_at: null },
    ])
    expect(value(sqlite, `SELECT count(*) FROM vendor_trade_documents WHERE vendor_id = ? AND superseded_at IS NULL`, KEEP)).toBe(3)

    // The kept vendor had no folder or bill choice, so it takes the archived vendor's.
    expect(all(sqlite, "SELECT trade_docs_folder_id, trade_docs_bill_mode, sage_vendor_id FROM vendors WHERE id = ?", KEEP))
      .toEqual([{ trade_docs_folder_id: "folder-gc", trade_docs_bill_mode: "warn", sage_vendor_id: "sage-guid" }])
    expect(all(sqlite, "SELECT merged_into_vendor_id, directory_status FROM vendors WHERE id = ?", SOURCE))
      .toEqual([{ merged_into_vendor_id: KEEP, directory_status: "merged" }])
    expect(value(sqlite, "SELECT kind FROM contact_merge_events WHERE source_id = ?", SOURCE)).toBe("vendor_company")
  })

  it("keeps the kept company's project contact on a project that lists both, retiring the duplicate", async () => {
    insert(sqlite, "projects", { id: "proj-h-office", name: "Home Office", organization_id: ORG, created_at: T0 })
    for (const [id, vendorId] of [["pc-office-dup", SOURCE], ["pc-office-keep", KEEP]]) {
      insert(sqlite, "project_contacts", {
        id, project_id: "proj-h-office", contact_type: "subcontractor", display_name: "Guaranteed Caulking",
        vendor_id: vendorId, source_entity_type: "vendor", source_entity_id: vendorId, created_at: T0, updated_at: T0,
      })
    }
    await d1.batch(vendorMerge(d1))
    expect(all(sqlite, "SELECT id, vendor_id, active FROM project_contacts WHERE project_id = 'proj-h-office' ORDER BY id")).toEqual([
      { id: "pc-office-dup", vendor_id: KEEP, active: 0 },
      { id: "pc-office-keep", vendor_id: KEEP, active: 1 },
    ])
    // Elsewhere the archived company's project contact simply moves and stays active.
    expect(all(sqlite, "SELECT vendor_id, active FROM project_contacts WHERE id = 'pc-1'")).toEqual([{ vendor_id: KEEP, active: 1 }])
  })

  it("does nothing when the source was merged in the meantime (guarded moves)", async () => {
    sqlite.prepare("UPDATE vendors SET merged_into_vendor_id = 'vendor-older-dup' WHERE id = ?").run(SOURCE)
    await expect(d1.batch(vendorMerge(d1))).resolves.toBeDefined()
    expect(vendorIdOf(sqlite, "vendor_trade_documents", "doc-w9")).toBe(SOURCE)
    expect(vendorIdOf(sqlite, "vendor_contacts", "person-1")).toBe(SOURCE)
  })

  it("blocks different bill choices, an active Sage certificate sync, a foreign Sage vendor on a PO, and NetSuite bills", async () => {
    sqlite.prepare("UPDATE vendors SET trade_docs_bill_mode = 'stop', trade_docs_folder_id = 'folder-inc' WHERE id = ?").run(KEEP)
    insert(sqlite, "sage_vendor_certificate_syncs", { id: "sync-1", organization_id: ORG, vendor_id: SOURCE, status: "queued", requested_at: T0, updated_at: T0 })
    sqlite.prepare("UPDATE project_operations SET sage_vendor_id = 'OTHER-SAGE' WHERE id = 'po-2'").run()
    sqlite.prepare("UPDATE vendor_bills SET netsuite_id = 'ns-1' WHERE id = 'bill-1'").run()
    const details = await inspectCompanyMerge(d1, { side: "vendor", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP })
    expect(details.blockers).toEqual([
      expect.stringContaining("different trade-docs bill settings"),
      expect.stringContaining("Sage certificate sync"),
      expect.stringContaining("carry a Sage vendor"),
      expect.stringContaining("NetSuite"),
    ])
    expect(details.warnings).toContainEqual(expect.stringContaining("trade-docs Drive folder"))

    // Even without the preview, the statements never move accounting-owned rows.
    await d1.batch(vendorMerge(d1))
    expect(vendorIdOf(sqlite, "project_operations", "po-2")).toBe(SOURCE)
    expect(vendorIdOf(sqlite, "vendor_bills", "bill-1")).toBe(SOURCE)
    expect(vendorIdOf(sqlite, "sage_vendor_certificate_syncs", "sync-1")).toBe(SOURCE)
    expect(value(sqlite, "SELECT trade_docs_bill_mode FROM vendors WHERE id = ?", KEEP)).toBe("stop")
  })
})

describe("client company merge", () => {
  it("moves people, project contacts, client jobs, invoices, credit memos and payments", async () => {
    const { sqlite, d1 } = migrated()
    seedBase(sqlite)
    for (const [id, name] of [["client-dup", "Amaroo"], ["client-keep", "Amaroo LLC"]]) {
      insert(sqlite, "customers", { id, name, organization_id: ORG, created_at: T0, updated_at: T0 })
    }
    insert(sqlite, "customer_contacts", { id: "cp-1", customer_id: "client-dup", name: "Chris", created_at: T0, updated_at: T0 })
    sqlite.prepare("UPDATE projects SET client_customer_id = 'client-dup' WHERE id = 'project-1'").run()
    insert(sqlite, "invoices", { id: "inv-1", customer_id: "client-dup", issue_date: "2026-03-01", created_at: T0, updated_at: T0 })
    insert(sqlite, "invoices", { id: "inv-ns", customer_id: "client-dup", netsuite_id: "ns-9", issue_date: "2026-03-01", created_at: T0, updated_at: T0 })
    insert(sqlite, "credit_memos", { id: "cm-1", customer_id: "client-dup", issue_date: "2026-03-01", created_at: T0, updated_at: T0 })
    insert(sqlite, "payments", { id: "pay-c", customer_id: "client-dup", payment_type: "customer", amount: 5, payment_date: "2026-03-02", created_at: T0, updated_at: T0 })

    const pair = { side: "customer", organizationId: ORG, sourceId: "client-dup", destinationId: "client-keep" } as const
    const details = await inspectCompanyMerge(d1, pair)
    expect(details.blockers).toEqual([expect.stringContaining("NetSuite")])
    expect(Object.fromEntries(details.moves.map((move) => [move.category, move.count])))
      .toMatchObject({ people: 1, client_jobs: 1, invoices_payments: 4 })

    sqlite.prepare("DELETE FROM invoices WHERE id = 'inv-ns'").run()
    await d1.batch(companyMergeStatements(d1, {
      kind: "customer_company", organizationId: ORG, sourceId: "client-dup", destinationId: "client-keep",
      sourceSnapshot: "{}", destinationSnapshot: "{}", peopleCount: 1, projectContactCount: 0, userId: "user-1", now: NOW,
    }))
    expect(value(sqlite, "SELECT customer_id FROM customer_contacts WHERE id = 'cp-1'")).toBe("client-keep")
    expect(value(sqlite, "SELECT client_customer_id FROM projects WHERE id = 'project-1'")).toBe("client-keep")
    expect(value(sqlite, "SELECT customer_id FROM invoices WHERE id = 'inv-1'")).toBe("client-keep")
    expect(value(sqlite, "SELECT customer_id FROM credit_memos WHERE id = 'cm-1'")).toBe("client-keep")
    expect(value(sqlite, "SELECT customer_id FROM payments WHERE id = 'pay-c'")).toBe("client-keep")
    expect(value(sqlite, "SELECT merged_into_customer_id FROM customers WHERE id = 'client-dup'")).toBe("client-keep")
  })
})

describe("repairing a company merged before every reference moved", () => {
  it("moves the leftovers, records a <kind>_repair event once, and is safe to run again", async () => {
    const { sqlite, d1 } = migrated()
    seedBase(sqlite)
    seedVendorReferences(sqlite)
    sqlite.prepare("DELETE FROM vendor_trade_documents WHERE id IN ('doc-license', 'keep-license-old')").run()
    // The old merge: people and project contacts moved, the source archived, everything else left behind.
    sqlite.prepare("UPDATE vendor_contacts SET vendor_id = ? WHERE vendor_id = ?").run(KEEP, SOURCE)
    sqlite.prepare("UPDATE vendors SET merged_into_vendor_id = ?, directory_status = 'merged' WHERE id = ?").run(KEEP, SOURCE)

    const pair = { side: "vendor", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP, now: NOW } as const
    await d1.batch(companyMergeRepairStatements(d1, pair))
    expect(vendorIdOf(sqlite, "vendor_trade_documents", "doc-w9")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "vendor_trade_documents", "doc-coi-old")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_operations", "po-1")).toBe(KEEP)
    expect(value(sqlite, "SELECT count(*) FROM vendor_trade_documents WHERE vendor_id = ?", SOURCE)).toBe(0)
    const events = all(sqlite, "SELECT action, entity_type, entity_id, metadata FROM activity_events WHERE action = 'vendor_company_repair'")
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ entity_type: "vendor", entity_id: KEEP })
    const metadata: unknown = JSON.parse(String(events[0]?.metadata))
    expect(metadata).toMatchObject({ kind: "vendor_company_repair", sourceId: SOURCE, remaining: { trade_docs: 2, purchase_orders: 2 } })

    await d1.batch(companyMergeRepairStatements(d1, pair))
    expect(value(sqlite, "SELECT count(*) FROM activity_events WHERE action = 'vendor_company_repair'")).toBe(1)
  })

  it("does nothing for a pair that was never merged", async () => {
    const { sqlite, d1 } = migrated()
    seedBase(sqlite)
    seedVendorReferences(sqlite)
    await d1.batch(companyMergeRepairStatements(d1, { side: "vendor", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP, now: NOW }))
    expect(vendorIdOf(sqlite, "vendor_trade_documents", "doc-w9")).toBe(SOURCE)
    expect(value(sqlite, "SELECT count(*) FROM activity_events WHERE action = 'vendor_company_repair'")).toBe(0)
  })
})

describe("scripts/repair-company-merge.mjs", () => {
  it("prints batches of at most 100 values that repair the merge when run as SQL", () => {
    const { sqlite } = migrated()
    seedBase(sqlite)
    seedVendorReferences(sqlite)
    sqlite.prepare("UPDATE vendors SET merged_into_vendor_id = ?, directory_status = 'merged' WHERE id = ?").run(KEEP, SOURCE)

    const plan = buildRepairPlan({ kind: "vendor_company", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP, now: NOW })
    expect(plan.batches.length).toBeGreaterThan(1)
    for (const batch of plan.batches) expect(batch.values).toBeLessThanOrEqual(MAX_BATCH_VALUES)
    for (const query of plan.preflight) expect(() => sqlite.prepare(query.replace(/;$/, "")).all()).not.toThrow()

    for (const batch of plan.batches) sqlite.exec(batch.sql.join("\n"))
    expect(vendorIdOf(sqlite, "vendor_trade_documents", "doc-w9")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "vendor_trade_doc_links", "link-1")).toBe(KEEP)
    expect(vendorIdOf(sqlite, "project_warranty_claims", "claim-1", "assigned_vendor_id")).toBe(KEEP)
    expect(value(sqlite, "SELECT count(*) FROM activity_events WHERE action = 'vendor_company_repair' AND entity_id = ?", KEEP)).toBe(1)
  })

  it("rejects an unknown kind", () => {
    expect(() => buildRepairPlan({ kind: "vendor_person", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP, now: NOW }))
      .toThrow("--kind")
  })

  it("lists production drift tables in the preflight and moves one only when asked", () => {
    const base = { kind: "vendor_company", organizationId: ORG, sourceId: SOURCE, destinationId: KEEP, now: NOW }
    const plain = buildRepairPlan(base)
    expect(plain.preflight.some((query: string) => query.includes("'vendor_alias_pointers'"))).toBe(true)
    expect(plain.batches.flatMap((batch: { sql: string[] }) => batch.sql).some((sql: string) => sql.includes("vendor_alias_pointers"))).toBe(false)
    const extra = buildRepairPlan({ ...base, moveExtra: ["vendor_alias_pointers.vendor_id"] })
    expect(extra.batches.flatMap((batch: { sql: string[] }) => batch.sql).some((sql: string) =>
      sql.startsWith("UPDATE vendor_alias_pointers SET vendor_id = 'vendor-gc-inc' WHERE vendor_id = 'vendor-gc' AND EXISTS"))).toBe(true)
    expect(() => buildRepairPlan({ ...base, moveExtra: ["vendor_alias_pointers; DROP TABLE vendors"] })).toThrow("table.column")
  })
})

describe("planTradeDocMerge", () => {
  it("keeps the kept vendor's current document and never drops one", () => {
    const plan = planTradeDocMerge(
      [{ id: "a", docType: "coi", driveFileId: "f1", current: true }, { id: "b", docType: "coi", driveFileId: null, current: false }],
      [{ id: "k", docType: "w9", driveFileId: "f2", current: true }],
    )
    expect(plan).toEqual({ moved: ["a", "b"], becomeHistory: [], keptOnArchive: [], restoredOnKept: [] })
  })
})
