import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  requireOrg: vi.fn(),
  requireFeaturePermission: vi.fn(),
  requirePermission: vi.fn(),
  queueProjectContactTrackerRefresh: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: mocks.requireOrg }))
vi.mock("@/lib/demo", () => ({ isDemoUser: () => false, isDemoOrg: () => false }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: mocks.requireFeaturePermission }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-contact-tracker-refresh", () => ({
  queueProjectContactTrackerRefresh: mocks.queueProjectContactTrackerRefresh,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { mergeDuplicateContacts, previewContactMerge } from "@/app/actions/contact-duplicates"

type RecordRow = Record<string, unknown>

function company(id: string, sageClientId: string | null = null): RecordRow {
  return {
    id, name: id === "source" ? "Amaroo duplicate" : "Amaroo LLC",
    email: null, relationshipType: "client", mergedIntoCustomerId: null,
    sageClientId, sageClientNumber: null, buildertrendContactId: null, netsuiteId: null,
  }
}

function vendor(id: string, sourceRecordId: string | null): RecordRow {
  return {
    id, name: "Imported vendor", email: null, category: "Subcontractor",
    directoryStatus: "active", mergedIntoVendorId: null,
    sageVendorId: null, sageVendorNumber: null, netsuiteId: null, sourceRecordId,
  }
}

describe("contact duplicate merging", () => {
  const queues = new Map<string, RecordRow[][]>()
  const sql: string[] = []
  const filters: string[] = []
  const dialect = new SQLiteSyncDialect()
  const rawDb = {
    prepare: vi.fn((statement: string) => {
      sql.push(statement)
      return { bind: vi.fn(() => ({ statement })) }
    }),
    batch: vi.fn(async () => []),
  }
  const db = {
    select: vi.fn(() => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const tableName = getTableName(table)
        return {
          innerJoin: () => ({
            where: (condition: SQL) => {
              filters.push(dialect.sqlToQuery(condition).sql)
              return { get: async () => queues.get(tableName)?.shift()?.[0] }
            },
          }),
          where: (condition: SQL) => {
            filters.push(dialect.sqlToQuery(condition).sql)
            const rows = queues.get(tableName)?.shift() ?? []
            return {
              get: async () => rows[0],
              limit: async () => rows,
              then: (resolve: (value: RecordRow[]) => unknown) => Promise.resolve(rows).then(resolve),
            }
          },
        }
      },
    })),
  }

  function setQueues(source: RecordRow, destination: RecordRow): void {
    queues.set("customers", [[source], [destination]])
    queues.set("customer_contacts", [[], []])
    queues.set("project_contacts", [[], []])
    queues.set("sage_contact_read_requests", [[]])
    queues.set("sage_contact_change_proposals", [[]])
    queues.set("sage_contact_create_proposals", [[]])
    queues.set("sage_contact_snapshots", [[]])
    queues.set("sage_client_project_write_operations", [[]])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queues.clear()
    sql.length = 0
    filters.length = 0
    mocks.requireAuth.mockResolvedValue({ id: "reviewer", organizationId: "org-1" })
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: rawDb } })
    mocks.getDb.mockReturnValue(db)
    mocks.queueProjectContactTrackerRefresh.mockResolvedValue(undefined)
    setQueues(company("source"), company("keep", "sage-guid"))
  })

  it("previews a local duplicate without changing Sage or Compass records", async () => {
    const result = await previewContactMerge({
      kind: "customer_company", sourceId: "source", destinationId: "keep",
    })
    expect(result).toMatchObject({
      success: true,
      preview: { sourceName: "Amaroo duplicate", destinationName: "Amaroo LLC", blockers: [] },
    })
    expect(rawDb.batch).not.toHaveBeenCalled()
  })

  it("refuses to archive a Sage-linked source", async () => {
    setQueues(company("source", "different-sage-guid"), company("keep", "sage-guid"))
    const result = await mergeDuplicateContacts({
      kind: "customer_company", sourceId: "source", destinationId: "keep",
    })
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Sage") })
    expect(rawDb.batch).not.toHaveBeenCalled()
  })

  it("merges two Buildertrend-imported clients while retaining the archived ID", async () => {
    setQueues(
      { ...company("source"), buildertrendContactId: "34632719" },
      { ...company("keep"), buildertrendContactId: "34632698" }
    )
    const preview = await previewContactMerge({
      kind: "customer_company", sourceId: "source", destinationId: "keep",
    })
    expect(preview).toMatchObject({
      success: true,
      preview: {
        blockers: [],
        retainedIdentityNotice: expect.stringContaining("34632719"),
      },
    })
    setQueues(
      { ...company("source"), buildertrendContactId: "34632719" },
      { ...company("keep"), buildertrendContactId: "34632698" }
    )
    const result = await mergeDuplicateContacts({
      kind: "customer_company", sourceId: "source", destinationId: "keep",
    })
    expect(result).toEqual({ success: true, keptId: "keep" })
    // The merge only archives the source; its Buildertrend ID stays in that row.
    expect(sql.some((statement) => statement.includes("buildertrend_contact_id"))).toBe(false)
  })

  it("allows an imported vendor alias to be archived without discarding its source ID", async () => {
    queues.set("vendors", [[vendor("source", "legacy-101")], [vendor("keep", "legacy-202")]])
    queues.set("vendor_contacts", [[], []])
    queues.set("project_contacts", [[], []])
    queues.set("sage_contact_read_requests", [[]])
    queues.set("sage_contact_change_proposals", [[]])
    queues.set("sage_contact_create_proposals", [[]])
    queues.set("sage_contact_snapshots", [[]])
    const result = await mergeDuplicateContacts({
      kind: "vendor_company", sourceId: "source", destinationId: "keep",
    })
    expect(result).toEqual({ success: true, keptId: "keep" })
    expect(sql.some((statement) => statement.includes("source_record_id = NULL"))).toBe(false)
  })

  it("archives the source, relinks people/projects, and records an immutable audit snapshot atomically", async () => {
    setQueues(company("source"), company("keep", "sage-guid"))
    queues.set("customer_contacts", [[{
      id: "person-1", userId: null, sageContactId: null, sageLineNumber: null,
      sourceRecordId: null, isPrimary: false,
    }], []])
    queues.set("project_contacts", [[{ id: "project-contact-1", projectId: "project-1" }], []])
    const result = await mergeDuplicateContacts({
      kind: "customer_company", sourceId: "source", destinationId: "keep",
    })
    expect(result).toEqual({ success: true, keptId: "keep" })
    expect(rawDb.batch).toHaveBeenCalledTimes(1)
    expect(sql.some((statement) => statement.includes("INSERT INTO contact_merge_events"))).toBe(true)
    expect(sql.some((statement) => statement.includes("UPDATE customer_contacts SET customer_id"))).toBe(true)
    expect(sql.some((statement) => statement.includes("UPDATE project_contacts SET customer_id"))).toBe(true)
    expect(sql.some((statement) => statement.includes("merged_into_customer_id"))).toBe(true)
    expect(mocks.queueProjectContactTrackerRefresh).toHaveBeenCalledWith({
      db, organizationId: "org-1", projectId: "project-1",
    })
  })

  it("counts source-entity-only person project links before moving them", async () => {
    queues.set("customer_contacts", [
      [{ person: {
        id: "source-person", name: "Chris", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: null,
      }, company: { id: "company-1", mergedIntoCustomerId: null } }],
      [{ person: {
        id: "keep-person", name: "Chris Squires", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: null,
      }, company: { id: "company-1", mergedIntoCustomerId: null } }],
    ])
    queues.set("project_contacts", [[{ id: "legacy-link", projectId: "project-2" }], []])
    const result = await mergeDuplicateContacts({
      kind: "customer_person", sourceId: "source-person", destinationId: "keep-person",
    })
    expect(result).toEqual({ success: true, keptId: "keep-person" })
    const projectFilters = filters.filter((filter) => filter.includes('"project_contacts"'))
    expect(projectFilters).toHaveLength(2)
    for (const filter of projectFilters) {
      expect(filter).toContain('"customer_contact_id" = ?')
      expect(filter).toContain('"source_entity_type" = ?')
      expect(filter).toContain('"source_entity_id" = ?')
    }
    expect(mocks.queueProjectContactTrackerRefresh).toHaveBeenCalledWith({
      db, organizationId: "org-1", projectId: "project-2",
    })
  })

  it("allows a non-Sage imported person to merge within the same company", async () => {
    queues.set("customer_contacts", [
      [{ person: {
        id: "source-person", name: "Chris", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: "buildertrend-person-1",
      }, company: { id: "company-1", mergedIntoCustomerId: null } }],
      [{ person: {
        id: "keep-person", name: "Chris Squires", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: "buildertrend-person-2",
      }, company: { id: "company-1", mergedIntoCustomerId: null } }],
    ])
    queues.set("project_contacts", [[], []])
    const result = await previewContactMerge({
      kind: "customer_person", sourceId: "source-person", destinationId: "keep-person",
    })
    expect(result).toMatchObject({
      success: true,
      preview: { blockers: [], retainedIdentityNotice: expect.stringContaining("imported person ID") },
    })
  })

  it("refuses a person merge into an archived parent company", async () => {
    queues.set("customer_contacts", [
      [{ person: {
        id: "source-person", name: "Chris", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: null,
      }, company: { id: "company-1", mergedIntoCustomerId: null } }],
      [{ person: {
        id: "keep-person", name: "Chris Squires", email: null, customerId: "company-1",
        active: true, mergedIntoPersonId: null, userId: null, sageContactId: null,
        sageLineNumber: null, sourceRecordId: null,
      }, company: { id: "company-1", mergedIntoCustomerId: "another-company" } }],
    ])
    queues.set("project_contacts", [[], []])
    const result = await mergeDuplicateContacts({
      kind: "customer_person", sourceId: "source-person", destinationId: "keep-person",
    })
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("archived or merged") })
    expect(rawDb.batch).not.toHaveBeenCalled()
  })
})
