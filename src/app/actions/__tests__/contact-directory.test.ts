import { drizzle } from "drizzle-orm/d1"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { countingD1, migratedDatabase, seedDirectory, type QueryStats } from "@/lib/domain/contacts/__tests__/directory-seed"

const state = vi.hoisted(() => {
  const initial: { d1: unknown; role: string; canRead: boolean } = { d1: null, role: "admin", canRead: true }
  return initial
})
function user(): Record<string, unknown> {
  return {
    id: "user-a", email: "a@example.com", firstName: null, lastName: null, displayName: null, avatarUrl: null,
    role: state.role, googleEmail: null, isActive: true, lastLoginAt: null, organizationId: "org-a",
    organizationName: "A", organizationType: "company", createdAt: "", updatedAt: "",
  }
}
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user(), requireAuth: async () => user() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: state.d1 } }) }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: async () => state.canRead }))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))

import {
  findCompanyMergeCandidates,
  getContactDirectorySummary,
  getVendorDirectoryPage,
  getVendorDirectoryCompany,
} from "@/app/actions/contact-directory"

let sqlite: ReturnType<typeof migratedDatabase>
let stats: QueryStats

beforeAll(() => {
  sqlite = migratedDatabase()
  seedDirectory(sqlite, { vendors: 200, vendorPeople: 400, customers: 10, customerPeople: 10, tradeDocs: 150 })
  const counting = countingD1(sqlite)
  state.d1 = counting.d1
  stats = counting.stats
})
afterAll(() => sqlite.close())
beforeEach(() => {
  state.role = "admin"
  state.canRead = true
  stats.queries = 0
  stats.rows = 0
})

const firstPage = { search: "", sortId: null, sortDesc: false, pageIndex: 0, pageSize: 25 }

describe("contact directory actions", () => {
  it("returns trade doc standing for the visible vendors only, without reading the whole directory", async () => {
    const result = await getVendorDirectoryPage(firstPage, null)
    expect(result.success).toBe(true)
    if (!result.success) return
    const statuses = result.data.tradeDocStatuses ?? {}
    const visible = new Set(result.data.rows.map((row) => row.id))
    expect(Object.keys(statuses).length).toBeGreaterThan(0)
    expect(Object.keys(statuses).every((id) => visible.has(id))).toBe(true)
    // Page, trade doc settings, and the page's documents.
    expect(stats.queries).toBe(3)
    expect(stats.rows).toBeLessThan(100)
  })

  it("leaves trade docs out for people outside the office and refuses readers without access", async () => {
    state.role = "client"
    const outside = await getVendorDirectoryPage(firstPage, null)
    expect(outside.success && outside.data.tradeDocStatuses).toBeNull()
    state.canRead = false
    expect((await getVendorDirectoryPage(firstPage, null)).success).toBe(false)
  })

  it("filters by category and ignores sort ids the list does not allow", async () => {
    const result = await getVendorDirectoryPage({ ...firstPage, sortId: "organization_id", pageSize: 100 }, "Consultant")
    expect(result.success && result.data.rows.every((row) => row.category === "Consultant")).toBe(true)
    // 40 seeded consultants, less vendor 97, which the seed makes Internal.
    expect(result.success && result.data.total).toBe(39)
  })

  it("loads one vendor's people when its dialog opens, scoped to the organization", async () => {
    const vendor = await getVendorDirectoryCompany("org-a-vendor-3")
    expect(vendor.success && vendor.data.contacts.map((person) => person.id).sort()).toEqual(["org-a-vp-203", "org-a-vp-3"])
    expect((await getVendorDirectoryCompany("org-b-vendor-3")).success).toBe(false)
  })

  it("searches merge candidates and the tab counts", async () => {
    const found = await findCompanyMergeCandidates({ kind: "vendor", search: "Glass", excludeId: "org-a-vendor-9" })
    expect(found.success && found.data.length).toBeGreaterThan(0)
    expect(found.success && found.data.some((candidate) => candidate.id === "org-a-vendor-9")).toBe(false)
    const summary = await getContactDirectorySummary()
    expect(summary.success && summary.data).toMatchObject({ vendorCount: 197, customerCount: 10 })
  })
})
