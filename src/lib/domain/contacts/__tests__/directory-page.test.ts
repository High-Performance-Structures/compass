import { drizzle } from "drizzle-orm/d1"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  INTERNAL_MERGE_BLOCKER,
  listCustomerDirectoryPage,
  listVendorDirectoryPage,
  loadDirectorySummary,
  searchCompanyMergeCandidates,
} from "@/lib/domain/contacts/directory-page"
import { DEFAULT_RECORD_PAGE_QUERY, parseRecordPageQuery, type RecordPageQuery } from "@/lib/record-page"
import type { Db } from "@/lib/server/action-context"

import { countingD1, migratedDatabase, seedDirectory, type QueryStats } from "./directory-seed"

let sqlite: ReturnType<typeof migratedDatabase>
let db: Db
let stats: QueryStats

function query(overrides: Partial<RecordPageQuery> = {}): RecordPageQuery {
  return { ...DEFAULT_RECORD_PAGE_QUERY, ...overrides }
}

beforeAll(() => {
  sqlite = migratedDatabase()
  seedDirectory(sqlite, { vendors: 300, vendorPeople: 600, customers: 200, customerPeople: 200, tradeDocs: 0 })
  seedDirectory(sqlite, { vendors: 20, vendorPeople: 20, customers: 20, customerPeople: 20, tradeDocs: 0 }, "org-b")
  const counting = countingD1(sqlite)
  stats = counting.stats
  // @ts-expect-error The counting binding implements only what drizzle's D1 driver calls.
  db = drizzle(counting.d1)
})
afterAll(() => sqlite.close())
// Each test's edits roll back, so the seeded directory is built once.
beforeEach(() => {
  sqlite.exec("SAVEPOINT directory_test")
  stats.queries = 0
  stats.rows = 0
  stats.maxParams = 0
})
afterEach(() => sqlite.exec("ROLLBACK TO directory_test; RELEASE directory_test"))

// Seed: 300 vendors, every 97th is "Internal" (0, 97, 194, 291), so 296 are listed.
describe("vendor directory page", () => {
  it("pages with one query, the matching total, and stays in the organization", async () => {
    const first = await listVendorDirectoryPage(db, "org-a", query(), null)
    expect(first.total).toBe(296)
    expect(first.rows).toHaveLength(25)
    expect(stats.queries).toBe(1)
    const second = await listVendorDirectoryPage(db, "org-a", query({ pageIndex: 1 }), null)
    expect(second.total).toBe(296)
    expect(second.rows.map((row) => row.id)).not.toEqual(expect.arrayContaining(first.rows.map((row) => row.id)))
    expect(first.rows.every((row) => row.id.startsWith("org-a-"))).toBe(true)
    expect(first.rows.some((row) => row.category === "Internal")).toBe(false)
  })

  it("reports the total even past the last page", async () => {
    const past = await listVendorDirectoryPage(db, "org-a", query({ pageIndex: 50 }), null)
    expect(past.rows).toEqual([])
    expect(past.total).toBe(296)
  })

  it("finds a company by its people's names, emails and phones as well as its own fields", async () => {
    // vendor 5's people are vp-5 and vp-305 ("Finley Hayes305", phone 719-444-0305).
    sqlite.prepare("UPDATE vendor_contacts SET name = 'Zelda Quartermaine', email = 'zq@acme.example' WHERE id = 'org-a-vp-5'").run()
    for (const search of ["quartermaine", "ZQ@ACME", "Hayes305", "(719) 444-0305", "7194440305"]) {
      const page = await listVendorDirectoryPage(db, "org-a", query({ search }), null)
      expect(page.rows.map((row) => row.id), search).toEqual(["org-a-vendor-5"])
      expect(page.total).toBe(1)
    }
    const byCompanyEmail = await listVendorDirectoryPage(db, "org-a", query({ search: "office12@" }), null)
    expect(byCompanyEmail.rows.map((row) => row.id)).toEqual(["org-a-vendor-12"])
  })

  it("ignores inactive people, other organizations, and treats wildcards literally", async () => {
    sqlite.prepare("UPDATE vendor_contacts SET name = 'Hidden Person', active = 0 WHERE id = 'org-a-vp-7'").run()
    expect((await listVendorDirectoryPage(db, "org-a", query({ search: "Hidden Person" }), null)).total).toBe(0)
    expect((await listVendorDirectoryPage(db, "org-a", query({ search: "org-b" }), null)).total).toBe(0)
    expect((await listVendorDirectoryPage(db, "org-a", query({ search: "%" }), null)).total).toBe(0)
    expect((await listVendorDirectoryPage(db, "org-a", query({ search: "_" }), null)).total).toBe(0)
  })

  it("sorts on the server, blanks last in both directions", async () => {
    sqlite.prepare("UPDATE vendors SET email = NULL WHERE id = 'org-a-vendor-1'").run()
    const ascending = await listVendorDirectoryPage(db, "org-a", query({ sortId: "email", pageSize: 100, pageIndex: 2 }), null)
    expect(ascending.rows.at(-1)?.id).toBe("org-a-vendor-1")
    const descending = await listVendorDirectoryPage(db, "org-a", query({ sortId: "email", sortDesc: true, pageSize: 100, pageIndex: 2 }), null)
    expect(descending.rows.at(-1)?.id).toBe("org-a-vendor-1")

    const byPeople = await listVendorDirectoryPage(db, "org-a", query({ sortId: "people", sortDesc: true }), null)
    const counts = byPeople.rows.map((row) => row.peopleCount)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(byPeople.rows[0]?.primaryPersonName).not.toBeNull()

    const byName = await listVendorDirectoryPage(db, "org-a", query({ pageSize: 100 }), null)
    const names = byName.rows.map((row) => row.name.toLowerCase())
    expect(names).toEqual([...names].sort())
  })

  it("filters by category and keeps every page within D1's bound-parameter limit", async () => {
    const suppliers = await listVendorDirectoryPage(db, "org-a", query({ search: "7194440305 ", pageSize: 100 }), "Supplier")
    expect(suppliers.rows.every((row) => row.category === "Supplier")).toBe(true)
    await listVendorDirectoryPage(db, "org-a", query({ search: "(719) 555", sortId: "people", pageSize: 100 }), "Supplier")
    expect(stats.maxParams).toBeLessThanOrEqual(100)
  })
})

describe("client and lead directory page", () => {
  it("searches people at the client and skips merged clients", async () => {
    const page = await listCustomerDirectoryPage(db, "org-a", query({ search: "spouse17@home" }))
    expect(page.rows.map((row) => row.id)).toEqual(["org-a-customer-17"])
    expect(page.rows[0]?.peopleCount).toBe(1)
    sqlite.prepare("UPDATE customers SET merged_into_customer_id = 'org-a-customer-18' WHERE id = 'org-a-customer-17'").run()
    expect((await listCustomerDirectoryPage(db, "org-a", query({ search: "spouse17@home" }))).total).toBe(0)
    expect((await listCustomerDirectoryPage(db, "org-a", query())).total).toBe(199)
  })

  it("sorts by status and date added", async () => {
    const leadsFirst = await listCustomerDirectoryPage(db, "org-a", query({ sortId: "relationshipType", sortDesc: true }))
    expect(leadsFirst.rows.every((row) => row.relationshipType === "lead")).toBe(true)
  })
})

describe("merge candidates and summary", () => {
  it("finds the other record by search, excludes the anchor, and explains internal records", async () => {
    expect(await searchCompanyMergeCandidates(db, "org-a", { kind: "vendor", search: "", excludeId: "org-a-vendor-1" })).toEqual([])
    const found = await searchCompanyMergeCandidates(db, "org-a", { kind: "vendor", search: "Concrete Reed 0 LLC", excludeId: "org-a-vendor-1" })
    expect(found).toEqual([expect.objectContaining({ id: "org-a-vendor-0", blockedReason: INTERNAL_MERGE_BLOCKER })])
    const plain = await searchCompanyMergeCandidates(db, "org-a", { kind: "vendor", search: "Electric", excludeId: "org-a-vendor-1" })
    expect(plain.length).toBeGreaterThan(0)
    expect(plain.every((candidate) => candidate.id !== "org-a-vendor-1" && candidate.blockedReason === null)).toBe(true)
    const clients = await searchCompanyMergeCandidates(db, "org-a", { kind: "customer", search: "Spouse3", excludeId: "org-a-customer-3" })
    expect(clients.map((candidate) => candidate.id)).not.toContain("org-a-customer-3")
    expect(clients.every((candidate) => candidate.id.startsWith("org-a-"))).toBe(true)
  })

  it("counts each tab and lists categories in one round trip", async () => {
    const summary = await loadDirectorySummary(db, "org-a", { customers: true, vendors: true, internal: false })
    expect(summary).toMatchObject({ customerCount: 200, vendorCount: 296, internalCount: 0 })
    expect(summary.vendorCategories).not.toContain("Internal")
    expect(summary.vendorCategories).toContain("Supplier")
  })

  it("parses untrusted list queries", () => {
    expect(parseRecordPageQuery({ search: "  acme ", sortId: "drop table", sortDesc: true, pageIndex: -4, pageSize: 1000 }, ["name"]))
      .toEqual({ search: "acme", sortId: null, sortDesc: false, pageIndex: 0, pageSize: 25 })
    expect(parseRecordPageQuery({ sortId: "name", sortDesc: true, pageIndex: 3, pageSize: 100 }, ["name"]))
      .toEqual({ search: "", sortId: "name", sortDesc: true, pageIndex: 3, pageSize: 100 })
    expect(parseRecordPageQuery("nonsense", ["name"])).toEqual(DEFAULT_RECORD_PAGE_QUERY)
  })
})
