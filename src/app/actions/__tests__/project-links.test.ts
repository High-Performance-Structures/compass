import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projects } from "@/db/schema"
import { projectLinks } from "@/db/schema-project-links"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  can: vi.fn(),
  assertProjectAccess: vi.fn(),
  getProjectAccessRecord: vi.fn(),
  recordActivityEvent: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: () => "org" }))
vi.mock("@/lib/demo", () => ({ isDemoUser: (id: string) => id === "demo" }))
vi.mock("@/lib/permissions", () => ({ can: mocks.can }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  getProjectAccessRecord: mocks.getProjectAccessRecord,
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: vi.fn() }))
vi.mock("@/app/actions/projects", () => ({ createProjectIntake: vi.fn() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: null } })) }))
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
  const db = drizzle(sqlite)
  db.insert(projects).values([
    { id: "design", name: "Mitchell Residence", projectNumber: "D-26-33", organizationId: "org", createdAt: "t", updatedAt: "t" },
    { id: "build", name: "Mitchell Residence", projectNumber: "O-210-33", organizationId: "org", createdAt: "t", updatedAt: "t" },
    { id: "elsewhere", name: "Other company job", projectNumber: "O-1-1", organizationId: "other-org", createdAt: "t", updatedAt: "t" },
  ]).run()
  mocks.getDb.mockReturnValue({ select: db.select.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db) })
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
