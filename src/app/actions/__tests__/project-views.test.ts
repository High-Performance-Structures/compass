import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { projectSavedViews, userViewPreferences } from "@/db/schema"
import { DEFAULT_PROJECT_VIEW, projectDefaultViewKey, type ProjectViewDefinition } from "@/lib/project-views"

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), revalidate: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: null } }) }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { deleteProjectView, getProjectSavedViews, getProjectViewPreferences, saveProjectView, setDefaultProjectView } from "@/app/actions/project-views"

let sqlite: InstanceType<typeof Database>
const definition: ProjectViewDefinition = { department: "H", status: { kind: "job", jobStatusId: "under_construction" } }
function user(id = "alice", organizationId: string | null = "org-a", role = "office"): void {
  mocks.user.mockResolvedValue({ id, organizationId, role })
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('alice'), ('bob'), ('carol'), ('demo-user-001');
    INSERT INTO organizations VALUES ('org-a'), ('org-b');
    CREATE TABLE user_view_preferences (user_id TEXT NOT NULL, view_key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, view_key));
    CREATE TABLE project_job_statuses (id TEXT, organization_id TEXT, active INTEGER);
  `)
  sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0260_project_saved_views.sql"), "utf8").replaceAll("--> statement-breakpoint", ""))
  mocks.db.mockReturnValue(drizzle(sqlite))
  user()
})
afterEach(() => sqlite.close())

async function create(name: string, visibility: "personal" | "shared" = "personal"): Promise<string> {
  const result = await saveProjectView({ id: null, name, visibility, definition })
  if (!result.success) throw new Error(result.error)
  return result.view.id
}

describe("project view actions with real SQLite queries", () => {
  it("persists defaults independently per user and organization and resets only the current default", async () => {
    expect(await setDefaultProjectView(definition)).toEqual({ success: true })
    expect(await getProjectViewPreferences()).toMatchObject({ defaultDefinition: definition, canSave: true })
    user("bob")
    expect(await getProjectViewPreferences()).toMatchObject({ defaultDefinition: null })
    await setDefaultProjectView(DEFAULT_PROJECT_VIEW)
    user("alice", "org-b")
    expect(await getProjectViewPreferences()).toMatchObject({ defaultDefinition: null })
    await setDefaultProjectView(DEFAULT_PROJECT_VIEW)
    user()
    await setDefaultProjectView(null)
    expect(await getProjectViewPreferences()).toMatchObject({ defaultDefinition: null })
    const rows = drizzle(sqlite).select().from(userViewPreferences).all()
    expect(rows.map((row) => [row.userId, row.viewKey])).toEqual(expect.arrayContaining([["bob", projectDefaultViewKey("org-a")], ["alice", projectDefaultViewKey("org-b")]]))
    expect(rows).toHaveLength(2)
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })

  it("shows other staff only shared views in their own organization", async () => {
    await create("Alice private")
    const shared = await create("Alice shared", "shared")
    user("carol", "org-b")
    await create("Other company shared", "shared")
    user("bob")
    const result = await getProjectSavedViews()
    expect(result.error).toBeNull()
    expect(result.views).toMatchObject([{ id: shared, name: "Alice shared", isOwner: false }])
    expect(result.views).toHaveLength(1)
    user()
    expect((await getProjectSavedViews()).views.map((view) => view.name)).toEqual(["Alice private", "Alice shared"])
  })

  it("blocks non-owner and cross-organization updates, sharing and deletions", async () => {
    const id = await create("Shared", "shared")
    for (const identity of [{ id: "bob", org: "org-a" }, { id: "alice", org: "org-b" }]) {
      user(identity.id, identity.org)
      expect(await saveProjectView({ id, name: "Hijacked", visibility: "personal", definition: DEFAULT_PROJECT_VIEW })).toMatchObject({ success: false })
      expect(await deleteProjectView(id)).toMatchObject({ success: false })
    }
    const rows = drizzle(sqlite).select().from(projectSavedViews).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ownerUserId: "alice", organizationId: "org-a", name: "Shared", visibility: "shared" })
  })

  it("preserves another user's default when a shared view changes, becomes private, or is deleted", async () => {
    const id = await create("Shared", "shared")
    user("bob")
    await setDefaultProjectView(definition)
    user()
    expect(await saveProjectView({ id, name: "Renamed", visibility: "personal", definition: DEFAULT_PROJECT_VIEW })).toMatchObject({ success: true })
    user("bob")
    expect((await getProjectSavedViews()).views).toHaveLength(0)
    expect((await getProjectViewPreferences()).defaultDefinition).toEqual(definition)
    user()
    expect(await deleteProjectView(id)).toEqual({ success: true })
    user("bob")
    expect((await getProjectViewPreferences()).defaultDefinition).toEqual(definition)
  })

  it("requires unique names per owner per organization without overwriting an existing view", async () => {
    await create("Construction")
    expect(await saveProjectView({ id: null, name: "Construction", visibility: "shared", definition })).toMatchObject({ success: false })
    user("bob")
    await create("Construction")
    user("alice", "org-b")
    await create("Construction")
    expect(drizzle(sqlite).select().from(projectSavedViews).all()).toHaveLength(3)
  })

  it("validates custom statuses against the org directory and falls back safely when deleted", async () => {
    const custom: ProjectViewDefinition = { department: "O", status: { kind: "job", jobStatusId: "custom:review" } }
    expect(await setDefaultProjectView(custom)).toMatchObject({ success: false })
    sqlite.exec("INSERT INTO project_job_statuses VALUES ('custom:review', 'org-b', 1)")
    expect(await setDefaultProjectView(custom)).toMatchObject({ success: false })
    sqlite.exec("INSERT INTO project_job_statuses VALUES ('custom:review', 'org-a', 1)")
    expect(await setDefaultProjectView(custom)).toEqual({ success: true })
    expect((await getProjectViewPreferences()).defaultDefinition).toEqual(custom)
    sqlite.exec("DELETE FROM project_job_statuses WHERE organization_id = 'org-a'")
    expect((await getProjectViewPreferences()).defaultDefinition).toEqual(DEFAULT_PROJECT_VIEW)
    sqlite.exec("UPDATE user_view_preferences SET value = 'malformed'")
    expect((await getProjectViewPreferences()).defaultDefinition).toEqual(DEFAULT_PROJECT_VIEW)
  })

  it("rejects invalid names and blocks external, organization-less, and demo mutations", async () => {
    expect(await saveProjectView({ id: null, name: "   ", visibility: "personal", definition })).toMatchObject({ success: false })
    for (const identity of [{ id: "alice", org: "org-a", role: "client" }, { id: "alice", org: null, role: "office" }, { id: "demo-user-001", org: "org-a", role: "admin" }]) {
      user(identity.id, identity.org, identity.role)
      expect(await setDefaultProjectView(definition)).toMatchObject({ success: false })
      expect(await saveProjectView({ id: null, name: "No", visibility: "shared", definition })).toMatchObject({ success: false })
      expect(await deleteProjectView("missing")).toMatchObject({ success: false })
    }
    expect(drizzle(sqlite).select().from(projectSavedViews).all()).toEqual([])
  })
})
