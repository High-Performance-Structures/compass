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
  directoryIdentityManagedByActiveUser: vi.fn(),
  requestSageEditFromCompass: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
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
vi.mock("@/lib/contact-identity-ownership", () => ({ directoryIdentityManagedByActiveUser: mocks.directoryIdentityManagedByActiveUser }))
vi.mock("@/lib/sage/contact-proposal-service", () => ({ requestSageEditFromCompass: mocks.requestSageEditFromCompass }))

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
  const bound: { readonly statement: string; readonly binds: readonly unknown[] }[] = []
  const filters: string[] = []
  const dialect = new SQLiteSyncDialect()
  const rawDb = {
    prepare: vi.fn((statement: string) => {
      sql.push(statement)
      // Company merges also read reference counts and trade docs: nothing to move here.
      return { bind: vi.fn((...binds: unknown[]) => {
        bound.push({ statement, binds })
        return { statement, first: async () => null, all: async () => ({ results: [] }) }
      }) }
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
    bound.length = 0
    mocks.directoryIdentityManagedByActiveUser.mockResolvedValue(false)
    mocks.requestSageEditFromCompass.mockResolvedValue({ status: "requested", proposalId: "proposal-1" })
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
    // Every reference moves in the same batch, not only people and project contacts.
    for (const table of ["vendor_trade_documents", "vendor_trade_doc_links", "project_operations", "vendor_bills", "project_warranty_claims"]) {
      expect(sql.some((statement) => statement.includes(`UPDATE ${table} SET`))).toBe(true)
    }
    expect(sql.findLastIndex((statement) => statement.includes("directory_status = 'merged'")))
      .toBeGreaterThan(sql.findIndex((statement) => statement.includes("UPDATE vendor_trade_documents SET vendor_id")))
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

  describe("carrying contact details to the kept record", () => {
    const carryUpdate = (table: string) => bound.find((entry) => entry.statement.startsWith(`UPDATE ${table} SET`) && entry.statement.includes("WHERE id = ? AND"))

    it("fills the kept record's blanks from the archived one, in the merge batch", async () => {
      setQueues(
        { ...company("source"), email: "owner@example.com", phone: "555-0100", city: "Springfield", state: "CO" },
        company("keep"))
      const preview = await previewContactMerge({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(preview).toMatchObject({ success: true, preview: { survivorSageLinked: false, fieldChanges: [
        { key: "email", action: "fill", keptValue: null, mergedValue: "owner@example.com" },
        { key: "phone", action: "fill", mergedValue: "555-0100" },
        { key: "address", action: "fill", mergedValue: "Springfield, CO" },
      ] } })
      setQueues(
        { ...company("source"), email: "owner@example.com", phone: "555-0100", city: "Springfield", state: "CO" },
        company("keep"))
      const result = await mergeDuplicateContacts({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(result).toEqual({ success: true, keptId: "keep" })
      const update = carryUpdate("customers")
      expect(update?.statement).toContain("email = ?, phone = ?, address_line_1 = ?, address_line_2 = ?, city = ?, state = ?, postal_code = ?, updated_at = ?")
      expect(update?.binds.slice(0, 7)).toEqual(["owner@example.com", "555-0100", null, null, "Springfield", "CO", null])
      // Written before the source is archived, so the guard still sees it live.
      expect(sql.findIndex((statement) => statement === update?.statement))
        .toBeLessThan(sql.findIndex((statement) => statement.startsWith("UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE id = ?")))
      expect(mocks.requestSageEditFromCompass).not.toHaveBeenCalled()
    })

    it("keeps the kept record's value on a conflict unless staff choose the archived one", async () => {
      const source = { ...company("source"), phone: "555-0100", notes: "Gate code 1234" }
      const keep = { ...company("keep"), phone: "555-0199", notes: null }
      setQueues(source, keep)
      const preview = await previewContactMerge({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(preview).toMatchObject({ success: true, preview: { fieldChanges: [
        { key: "phone", action: "choose", keptValue: "555-0199", mergedValue: "555-0100" },
        { key: "notes", action: "fill" },
      ] } })

      setQueues(source, keep)
      await mergeDuplicateContacts({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(carryUpdate("customers")?.statement).not.toContain("phone = ?")

      bound.length = 0
      setQueues(source, keep)
      await mergeDuplicateContacts({ kind: "customer_company", sourceId: "source", destinationId: "keep", choices: { phone: "merged" } })
      const update = carryUpdate("customers")
      expect(update?.statement).toContain("phone = ?, notes = ?")
      expect(update?.binds.slice(0, 2)).toEqual(["555-0100", "Gate code 1234"])
    })

    it("sends a Sage-linked survivor's Sage fields to Sage review instead of writing them directly", async () => {
      setQueues(
        { ...company("source"), email: "owner@example.com", phone: "555-0100", notes: "Prefers text" },
        company("keep", "sage-guid"))
      const result = await mergeDuplicateContacts({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(result).toEqual({ success: true, keptId: "keep" })
      expect(mocks.requestSageEditFromCompass).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }), "client_company", "keep", { email: "owner@example.com", phone: "555-0100" })
      // Compass-only notes still land with the merge; Sage fields never do.
      const update = carryUpdate("customers")
      expect(update?.statement).toContain("notes = ?")
      expect(update?.statement).not.toMatch(/email = \?|phone = \?/)
      expect(sql.some((statement) => statement.includes("sage_contact_change_proposals"))).toBe(false)
    })

    it("warns when the Sage change request is blocked", async () => {
      mocks.requestSageEditFromCompass.mockResolvedValue({ status: "blocked", error: "Sage refused." })
      setQueues({ ...company("source"), email: "owner@example.com" }, company("keep", "sage-guid"))
      const result = await mergeDuplicateContacts({ kind: "customer_company", sourceId: "source", destinationId: "keep" })
      expect(result).toMatchObject({ success: true, warning: expect.stringContaining("Email") })
    })

    it("never changes a sign-in email of someone who accepted an invite", async () => {
      mocks.directoryIdentityManagedByActiveUser.mockResolvedValue(true)
      const person = (id: string, email: string | null, cellPhone: string | null) => ({ person: {
        id, name: "Chris", email, cellPhone, customerId: "company-1", active: true, mergedIntoPersonId: null,
        userId: null, sageContactId: null, sageLineNumber: null, sourceRecordId: null,
      }, company: { id: "company-1", mergedIntoCustomerId: null } })
      queues.set("customer_contacts", [[person("source-person", "chris@example.com", "555-0111")], [person("keep-person", "login@example.com", null)]])
      queues.set("project_contacts", [[], []])
      const result = await mergeDuplicateContacts({
        kind: "customer_person", sourceId: "source-person", destinationId: "keep-person", choices: { email: "merged" },
      })
      expect(result).toEqual({ success: true, keptId: "keep-person" })
      const update = carryUpdate("customer_contacts")
      expect(update?.statement).toContain("cell_phone = ?")
      expect(update?.statement).not.toContain("email = ?")
    })

    it("merges a vendor excluded as a duplicate into the vendor that survives it", async () => {
      queues.set("vendors", [[{ ...vendor("source", null), directoryStatus: "excluded_duplicate", phone: "555-0100" }], [vendor("keep", null)]])
      queues.set("vendor_contacts", [[], []])
      queues.set("project_contacts", [[], []])
      queues.set("sage_contact_read_requests", [[]])
      queues.set("sage_contact_change_proposals", [[]])
      queues.set("sage_contact_create_proposals", [[]])
      queues.set("sage_contact_snapshots", [[]])
      const result = await mergeDuplicateContacts({ kind: "vendor_company", sourceId: "source", destinationId: "keep" })
      expect(result).toEqual({ success: true, keptId: "keep" })
      expect(carryUpdate("vendors")?.binds[0]).toBe("555-0100")
      expect(bound.find((entry) => entry.statement.includes("directory_status = 'merged'"))?.binds.slice(0, 1)).toEqual(["keep"])
    })
  })
})
