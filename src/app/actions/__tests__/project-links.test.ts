import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projectProfileAuditEvents, projects } from "@/db/schema"
import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { projectLinks } from "@/db/schema-project-links"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  can: vi.fn(),
  assertProjectAccess: vi.fn(),
  getProjectAccessRecord: vi.fn(),
  recordActivityEvent: vi.fn(),
  readFeatureSettings: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: () => "org" }))
vi.mock("@/lib/demo", () => ({ isDemoUser: (id: string) => id === "demo" }))
vi.mock("@/lib/permissions", () => ({ can: mocks.can }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  getProjectAccessRecord: mocks.getProjectAccessRecord,
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: mocks.readFeatureSettings }))
vi.mock("@/app/actions/projects", () => ({ createProjectIntake: vi.fn() }))
vi.mock("@/lib/server/action-context", () => ({
  orgContext: async () => ({
    success: true,
    data: { user: await mocks.requireAuth(), organizationId: "org", db: mocks.getDb(), env: {} },
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { linkExistingProject, removeProjectLink } from "@/app/actions/project-links"

let sqlite: InstanceType<typeof Database>

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function links(): readonly unknown[] {
  return sqlite.prepare("SELECT project_id, linked_project_id, label FROM project_links ORDER BY created_at").all()
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  createTable(projects)
  createTable(projectLinks)
  createTable(projectWorkflowChecks)
  createTable(projectProfileAuditEvents)
  mocks.readFeatureSettings.mockResolvedValue({ departments: {}, order: {}, customSteps: {} })
  const db = drizzle(sqlite)
  db.insert(projects).values([
    { id: "design", name: "Mitchell Residence", projectNumber: "D-26-33", organizationId: "org", createdAt: "t", updatedAt: "t" },
    { id: "build", name: "Mitchell Residence", projectNumber: "O-210-33", organizationId: "org", createdAt: "t", updatedAt: "t" },
    { id: "elsewhere", name: "Other company job", projectNumber: "O-1-1", organizationId: "other-org", createdAt: "t", updatedAt: "t" },
  ]).run()
  // better-sqlite3 has no batch; run the statements in order like D1 would.
  const batch = async (statements: readonly PromiseLike<unknown>[]): Promise<unknown[]> => {
    const results: unknown[] = []
    for (const statement of statements) results.push(await statement)
    return results
  }
  mocks.getDb.mockReturnValue({ select: db.select.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db), batch })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin" })
  mocks.can.mockReturnValue(true)
  mocks.assertProjectAccess.mockResolvedValue(undefined)
  mocks.getProjectAccessRecord.mockImplementation(async (_db: unknown, _user: unknown, projectId: string) =>
    projectId === "missing" ? null : { id: projectId, organizationId: projectId === "elsewhere" ? "other-org" : "org", projectNumber: null },
  )
})
afterEach(() => sqlite.close())

describe("linking an existing job", () => {
  it("links two existing jobs and logs it on both", async () => {
    await expect(linkExistingProject("build", "design", " Design to construction ")).resolves.toEqual({ success: true })
    expect(links()).toEqual([{ project_id: "build", linked_project_id: "design", label: "Design to construction" }])
    expect(mocks.recordActivityEvent).toHaveBeenCalledTimes(2)
    expect(mocks.recordActivityEvent.mock.calls.map(([input]) => [input.projectId, input.summary])).toEqual([
      ["build", "Linked D-26-33 — Mitchell Residence."],
      ["design", "Linked O-210-33 — Mitchell Residence."],
    ])
  })

  it("won't link a job to itself", async () => {
    await expect(linkExistingProject("build", "build", null)).resolves.toEqual({ success: false, error: "Choose a different job to link." })
    expect(links()).toEqual([])
  })

  it("won't link a job in another company or one this person can't open", async () => {
    await expect(linkExistingProject("build", "elsewhere", null)).resolves.toMatchObject({ success: false })
    await expect(linkExistingProject("build", "missing", null)).resolves.toMatchObject({ success: false })
    expect(links()).toEqual([])
  })

  it("won't link the same two jobs twice in either direction", async () => {
    await linkExistingProject("build", "design", null)
    await expect(linkExistingProject("build", "design", null)).resolves.toEqual({
      success: false,
      error: "D-26-33 — Mitchell Residence is already linked to this job.",
    })
    await expect(linkExistingProject("design", "build", null)).resolves.toMatchObject({ success: false })
    expect(links()).toHaveLength(1)
  })

  it("needs permission to change projects", async () => {
    mocks.can.mockReturnValue(false)
    await expect(linkExistingProject("build", "design", null)).resolves.toEqual({ success: false, error: "You can't change linked jobs." })
    mocks.can.mockReturnValue(true)
    mocks.requireAuth.mockResolvedValue({ id: "demo", role: "admin" })
    await expect(linkExistingProject("build", "design", null)).resolves.toMatchObject({ success: false })
    expect(links()).toEqual([])
  })

  it("unlinking removes the link and logs it on both jobs", async () => {
    await linkExistingProject("build", "design", null)
    const row = sqlite.prepare("SELECT id FROM project_links").get()
    const linkId = typeof row === "object" && row !== null && "id" in row ? String(row.id) : ""
    mocks.recordActivityEvent.mockClear()
    await expect(removeProjectLink("design", linkId)).resolves.toEqual({ success: true })
    expect(links()).toEqual([])
    expect(mocks.recordActivityEvent.mock.calls.map(([input]) => input.action)).toEqual(["project.unlinked", "project.unlinked"])
  })
})

describe("carrying a Design job's workflow onto its linked Construction job", () => {
  function tick(projectId: string, itemKey: string, checkedBy: string | null, checkedAt: string): void {
    sqlite
      .prepare("INSERT INTO project_workflow_checks (id, organization_id, project_id, item_key, checked_by, checked_at) VALUES (?, 'org', ?, ?, ?, ?)")
      .run(crypto.randomUUID(), projectId, itemKey, checkedBy, checkedAt)
  }
  function checks(projectId: string): readonly unknown[] {
    return sqlite
      .prepare("SELECT item_key, checked_by, checked_at, carried_from_project_id, carried_from_item_key FROM project_workflow_checks WHERE project_id = ? ORDER BY item_key")
      .all(projectId)
  }

  it("ticks the matching Construction items with who ticked them and when, leaving existing ticks alone", async () => {
    tick("design", "agreement.signed", "pat", "2026-03-01T12:00:00.000Z")
    tick("design", "agreement.retainer", "pat", "2026-03-02T12:00:00.000Z")
    tick("design", "deliverables.documents", "sam", "2026-06-01T12:00:00.000Z")
    tick("design", "complete.handoff", "sam", "2026-06-02T12:00:00.000Z")
    tick("build", "design_agreement.retainer", "lee", "2026-03-05T12:00:00.000Z")

    await expect(linkExistingProject("build", "design", null)).resolves.toEqual({ success: true })
    expect(checks("build")).toEqual([
      { item_key: "construction_documents.stamped_set", checked_by: "sam", checked_at: "2026-06-01T12:00:00.000Z", carried_from_project_id: "design", carried_from_item_key: "deliverables.documents" },
      { item_key: "design_agreement.retainer", checked_by: "lee", checked_at: "2026-03-05T12:00:00.000Z", carried_from_project_id: null, carried_from_item_key: null },
      { item_key: "design_agreement.signed", checked_by: "pat", checked_at: "2026-03-01T12:00:00.000Z", carried_from_project_id: "design", carried_from_item_key: "agreement.signed" },
    ])
    // Nothing carries from Construction back onto Design by default.
    expect(checks("design")).toHaveLength(4)
    expect(sqlite.prepare("SELECT project_id, event_type FROM project_profile_audit_events").all()).toEqual([
      { project_id: "build", event_type: "workflow_carried_over" },
    ])
  })

  it("follows the company's matching, where an item can carry nothing", async () => {
    tick("design", "agreement.signed", "pat", "2026-03-01T12:00:00.000Z")
    tick("design", "intake.meeting", "pat", "2026-02-01T12:00:00.000Z")
    mocks.readFeatureSettings.mockResolvedValue({
      departments: {},
      order: {},
      customSteps: {},
      carryovers: [{ from: "D", to: "O", items: { "agreement.signed": "", "intake.meeting": "intake.meeting" } }],
    })
    await linkExistingProject("build", "design", null)
    expect(checks("build")).toEqual([
      expect.objectContaining({ item_key: "intake.meeting", carried_from_item_key: "intake.meeting" }),
    ])
  })
})
