import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  planRelationalLinks,
  relationalLinkRestoreSql,
  relationalLinkUpdateSql,
  type DirectoryRow,
  type RelationalLinkInput,
} from "../relational-links-plan"

const ORG = "org-a"
const OTHER = "org-b"

function directoryRow(row: Partial<DirectoryRow> & Pick<DirectoryRow, "kind" | "id" | "name">): DirectoryRow {
  return { organizationId: ORG, company: null, email: null, parentId: null, ...row }
}

function input(overrides: Partial<RelationalLinkInput>): RelationalLinkInput {
  return { directory: [], projects: [], operations: [], budgetLines: [], rfis: [], rfiContacts: [], projectContacts: [], ...overrides }
}

describe("planRelationalLinks", () => {
  it("links a project client by exact name, only when one client in the company matches", () => {
    const plan = planRelationalLinks(input({
      directory: [
        directoryRow({ kind: "customer", id: "c-1", name: "Jane Smith" }),
        directoryRow({ kind: "customer", id: "c-2", name: "Bob Lee" }),
        directoryRow({ kind: "customer", id: "c-3", name: "bob  lee" }),
        directoryRow({ kind: "customer", id: "c-9", name: "Jane Smith", organizationId: OTHER }),
      ],
      projects: [
        { id: "p-1", organizationId: ORG, name: "JANE SMITH" },
        { id: "p-2", organizationId: ORG, name: "Bob Lee" },
        { id: "p-3", organizationId: ORG, name: "Nobody" },
      ],
    }))
    expect(plan.links).toEqual([
      { section: "projectClients", table: "projects", id: "p-1", name: "JANE SMITH", rule: "name_company", set: { client_customer_id: "c-1" } },
    ])
    expect(plan.review.map((item) => [item.id, item.candidates.map((candidate) => candidate.id)])).toEqual([["p-2", ["c-2", "c-3"]]])
    expect(plan.counts.projectClients).toEqual({ checked: 3, exactByEmail: 0, exactByName: 1, ambiguous: 1, noMatch: 1 })
  })

  it("links an RFQ to its vendor by recipient email first, folding a person's email onto the vendor", () => {
    const plan = planRelationalLinks(input({
      directory: [
        directoryRow({ kind: "vendor", id: "v-1", name: "Acme Framing", email: "office@acme.test" }),
        directoryRow({ kind: "vendor_contact", id: "vc-1", name: "Al", email: "al@acme.test", parentId: "v-1" }),
        directoryRow({ kind: "vendor", id: "v-2", name: "Peak Supply" }),
      ],
      operations: [
        { id: "rfq-1", organizationId: ORG, name: "Typed Differently", email: " AL@acme.test " },
        { id: "rfq-2", organizationId: ORG, name: "Acme Framing", email: "office@acme.test" },
        { id: "po-1", organizationId: ORG, name: "peak supply", email: null },
        { id: "po-2", organizationId: ORG, name: "Al", email: null },
      ],
    }))
    expect(plan.links.map((link) => [link.id, link.rule, link.set])).toEqual([
      ["rfq-1", "email", { vendor_id: "v-1" }],
      // The vendor's own email and its person's are the same vendor: one match.
      ["rfq-2", "email", { vendor_id: "v-1" }],
      ["po-1", "name_company", { vendor_id: "v-2" }],
    ])
    // A person's name never links a vendor record.
    expect(plan.counts.operationVendors.noMatch).toBe(1)
  })

  it("links budget lines to vendors and RFI assignees to a contact on the same project", () => {
    const plan = planRelationalLinks(input({
      directory: [directoryRow({ kind: "vendor", id: "v-1", name: "Acme Framing" })],
      budgetLines: [{ id: "b-1", organizationId: ORG, name: "ACME framing" }],
      rfis: [
        { id: "r-1", projectId: "p-1", name: "Dana Cole" },
        { id: "r-2", projectId: "p-1", name: "Sam" },
        { id: "r-3", projectId: "p-2", name: "Dana Cole" },
      ],
      rfiContacts: [
        { id: "pc-1", projectId: "p-1", name: "Dana Cole" },
        { id: "pc-2", projectId: "p-1", name: "Sam" },
        { id: "pc-3", projectId: "p-1", name: "sam" },
      ],
    }))
    expect(plan.links.map((link) => [link.table, link.id, link.set])).toEqual([
      ["project_budget_lines", "b-1", { vendor_id: "v-1" }],
      ["project_rfis", "r-1", { assigned_project_contact_id: "pc-1" }],
    ])
    expect(plan.review.map((item) => item.id)).toEqual(["r-2"])
    expect(plan.counts.rfiAssignees.noMatch).toBe(1)
  })

  it("links a project contact to a directory person and its company together", () => {
    const plan = planRelationalLinks(input({
      directory: [
        directoryRow({ kind: "customer", id: "c-1", name: "Smith Family" }),
        directoryRow({ kind: "customer_contact", id: "cc-1", name: "Jane Smith", company: "Smith Family", email: "jane@x.test", parentId: "c-1" }),
        directoryRow({ kind: "internal_contact", id: "i-1", name: "Pat Office" }),
      ],
      projectContacts: [
        { id: "pc-1", organizationId: ORG, contactType: "owner", name: "J. Smith", company: null, email: "JANE@x.test" },
        { id: "pc-2", organizationId: ORG, contactType: "internal", name: "Pat Office", company: null, email: null },
        { id: "pc-3", organizationId: ORG, contactType: "subcontractor", name: "Jane Smith", company: null, email: "jane@x.test" },
      ],
    }))
    expect(plan.links.map((link) => [link.id, link.set])).toEqual([
      ["pc-1", { customer_id: "c-1", customer_contact_id: "cc-1" }],
      ["pc-2", { internal_contact_id: "i-1" }],
    ])
  })
})

describe("relational link SQL", () => {
  it("fills only NULL columns, escapes literals and refuses unknown tables", () => {
    const link = { section: "projectClients", table: "projects", id: "p'1", name: "x", rule: "name", set: { client_customer_id: "c-1" } } as const
    expect(relationalLinkUpdateSql(link)).toBe(
      "UPDATE projects SET client_customer_id = 'c-1' WHERE id = 'p''1' AND client_customer_id IS NULL;"
    )
    expect(relationalLinkRestoreSql(link)).toBe(
      "UPDATE projects SET client_customer_id = NULL WHERE id = 'p''1' AND client_customer_id = 'c-1';"
    )
    expect(() => relationalLinkUpdateSql({ ...link, table: "users" })).toThrow("Unknown link table")
  })
})

type SqliteStatement = { run: (...params: unknown[]) => { changes: number }; all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown }
type SqliteDatabase = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStatement; close: () => void }

async function migratedDatabase(): Promise<SqliteDatabase> {
  const { default: Database } = await import("better-sqlite3")
  const database: SqliteDatabase = new Database(":memory:")
  const dir = resolve(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    database.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  database.exec("PRAGMA foreign_keys = ON")
  return database
}

function isColumnInfo(value: unknown): value is { name: string; type: string; notnull: number; dflt_value: unknown; pk: number } {
  return typeof value === "object" && value !== null && "name" in value && "notnull" in value
}

/** Inserts a fixture row, filling any other required column with a placeholder. */
function seed(database: SqliteDatabase, table: string, values: Readonly<Record<string, unknown>>): void {
  const row: Record<string, unknown> = { ...values }
  for (const column of database.prepare(`PRAGMA table_info(${table})`).all().filter(isColumnInfo)) {
    if (column.name in row || column.notnull === 0 || column.dflt_value !== null) continue
    row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-fixture`
  }
  const columns = Object.keys(row)
  database.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row))
}

function value(database: SqliteDatabase, sql: string): unknown {
  const row = database.prepare(sql).get()
  return typeof row === "object" && row !== null ? Object.values(row)[0] : undefined
}

describe("relational link backfill on migrated fixtures", () => {
  it("applies the planned links through the 0280 columns and triggers, then restores them", async () => {
    const database = await migratedDatabase()
    try {
      seed(database, "organizations", { id: ORG, name: "Org A", slug: "org-a" })
      seed(database, "organizations", { id: OTHER, name: "Org B", slug: "org-b" })
      seed(database, "customers", { id: "c-1", organization_id: ORG, name: "Jane Smith" })
      seed(database, "customers", { id: "c-other", organization_id: OTHER, name: "Elsewhere" })
      seed(database, "vendors", { id: "v-1", organization_id: ORG, name: "Acme Framing" })
      seed(database, "projects", { id: "p-1", organization_id: ORG, name: "Job", client_name: "Jane Smith" })
      seed(database, "project_contacts", { id: "pc-1", project_id: "p-1", contact_type: "subcontractor", display_name: "Dana Cole" })
      seed(database, "project_operations", { id: "rfq-1", project_id: "p-1", source_record_type: "rfq", title: "Framing", sage_vendor_name: "Acme Framing" })
      seed(database, "project_budget_lines", { id: "b-1", project_id: "p-1", cost_code: "06", csi_division: "06", csi_division_name: "Wood", description: "Framing", vendor_name: "Acme Framing" })
      seed(database, "project_rfis", { id: "r-1", project_id: "p-1", rfi_number: "RFI-1", subject: "s", question: "q", assigned_to_name: "Dana Cole" })
      // Someone linked this budget line by hand already; the backfill must not overwrite it.
      seed(database, "vendors", { id: "v-2", organization_id: ORG, name: "Other Framing" })
      seed(database, "project_budget_lines", { id: "b-2", project_id: "p-1", cost_code: "06", csi_division: "06", csi_division_name: "Wood", description: "Framing", vendor_name: "Acme Framing", vendor_id: "v-2" })

      const plan = planRelationalLinks(input({
        directory: [
          directoryRow({ kind: "customer", id: "c-1", name: "Jane Smith" }),
          directoryRow({ kind: "vendor", id: "v-1", name: "Acme Framing" }),
        ],
        projects: [{ id: "p-1", organizationId: ORG, name: "Jane Smith" }],
        operations: [{ id: "rfq-1", organizationId: ORG, name: "Acme Framing", email: null }],
        // b-2 is listed as if read before the hand link landed.
        budgetLines: [{ id: "b-1", organizationId: ORG, name: "Acme Framing" }, { id: "b-2", organizationId: ORG, name: "Acme Framing" }],
        rfis: [{ id: "r-1", projectId: "p-1", name: "Dana Cole" }],
        rfiContacts: [{ id: "pc-1", projectId: "p-1", name: "Dana Cole" }],
      }))
      const changes = plan.links.map((link) => database.prepare(relationalLinkUpdateSql(link)).run().changes)
      expect(changes).toEqual([1, 1, 1, 0, 1])

      expect(value(database, "SELECT client_customer_id FROM projects WHERE id = 'p-1'")).toBe("c-1")
      expect(value(database, "SELECT vendor_id FROM project_operations WHERE id = 'rfq-1'")).toBe("v-1")
      expect(value(database, "SELECT vendor_id FROM project_budget_lines WHERE id = 'b-1'")).toBe("v-1")
      expect(value(database, "SELECT vendor_id FROM project_budget_lines WHERE id = 'b-2'")).toBe("v-2")
      expect(value(database, "SELECT assigned_project_contact_id FROM project_rfis WHERE id = 'r-1'")).toBe("pc-1")

      // The 0280 triggers keep links inside the company (and the project for RFIs).
      expect(() => database.exec("UPDATE projects SET client_customer_id = 'c-other' WHERE id = 'p-1'")).toThrow(
        "project client must belong to the project organization"
      )
      seed(database, "projects", { id: "p-2", organization_id: ORG, name: "Other job" })
      seed(database, "project_contacts", { id: "pc-2", project_id: "p-2", contact_type: "subcontractor", display_name: "Elsewhere" })
      expect(() => database.exec("UPDATE project_rfis SET assigned_project_contact_id = 'pc-2' WHERE id = 'r-1'")).toThrow(
        "RFI assignee must be a contact on the same project"
      )

      for (const link of plan.links) database.prepare(relationalLinkRestoreSql(link)).run()
      expect(value(database, "SELECT client_customer_id FROM projects WHERE id = 'p-1'")).toBeNull()
      expect(value(database, "SELECT vendor_id FROM project_budget_lines WHERE id = 'b-2'")).toBe("v-2")
    } finally {
      database.close()
    }
  })
})
