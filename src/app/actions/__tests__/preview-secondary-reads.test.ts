import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import { channels, channelMembers, channelReadState, messages, typingSessions } from "@/db/schema-conversations"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), viewer: vi.fn(), scope: vi.fn(), env: vi.fn(), writeGuard: vi.fn(), resourceProject: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.actor, getCurrentUser: mocks.actor }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.env }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn() }))
vi.mock("@/lib/project-audience-request-server", () => ({ requireProjectAudienceReadUser: mocks.viewer, getProjectAudienceRequestScope: mocks.scope, assertAudiencePreviewWriteAllowed: mocks.writeGuard, assertAudienceResourceProject: mocks.resourceProject }))
vi.mock("@/lib/conversations/preview-viewer", () => ({ conversationRequestViewer: mocks.viewer }))
import { setTyping, getChannelUpdates } from "@/app/actions/conversations-realtime"
import { getScheduleTaskAssignees } from "@/app/actions/schedule-confirmations"
import { listChannels, getChannel } from "@/app/actions/conversations"
import { getProjectRfiInboundEmails } from "@/app/actions/project-rfis"
let database: CorrespondenceTestDatabase
beforeEach(() => {
  database = openCorrespondenceTestDatabase()
  for (const table of [channels, channelMembers, channelReadState, messages, typingSessions]) {
    const config = getTableConfig(table)
    database.sqlite.exec(`CREATE TABLE "${config.name}" (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`).join(",")})`)
  }
  database.sqlite.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT")
  mocks.writeGuard.mockResolvedValue(undefined)
  mocks.resourceProject.mockImplementation(async (id: string) => { if (id !== "project-a") throw new Error("Record not found.") })
  mocks.actor.mockResolvedValue(context(database, "staff-a", "project-a").user)
  mocks.viewer.mockResolvedValue(context(database, "owner-a", "project-a").user)
  mocks.scope.mockResolvedValue({ projectId: "project-a", audience: "owner", targetUserId: "owner-a" })
  mocks.env.mockResolvedValue({ env: { DB: database.d1 } })
})
afterEach(() => { database.close(); vi.clearAllMocks() })
describe("preview secondary readers", () => {
  it("does not use staff identity to expose inbound RFI email bodies", async () => {
    expect(await getProjectRfiInboundEmails("project-a")).toEqual([])
    expect(mocks.env).not.toHaveBeenCalled()
  })
  it("limits channel discovery and direct channel reads to the validated project and audience", async () => {
    database.sqlite.exec(`
      INSERT INTO channels (id,name,type,organization_id,project_id,audience,is_private,sort_order,created_at,updated_at) VALUES
        ('a-owner','Current owner channel','text','org-a','project-a','clients',1,0,'2026-10-24','2026-10-24'),
        ('b-owner','Other project secret channel','text','org-a','project-b','clients',1,0,'2026-10-24','2026-10-24'),
        ('a-vendor','Other audience secret channel','text','org-a','project-a','sub_vendors',1,0,'2026-10-24','2026-10-24');
      INSERT INTO channel_members (id,channel_id,user_id,role) VALUES ('a','a-owner','owner-a','member'),('b','b-owner','owner-a','member'),('c','a-vendor','owner-a','member');
    `)
    const result = await listChannels()
    expect(result.success).toBe(true)
    if (!result.success || !result.data) throw new Error("Expected channels")
    expect(result.data.map((row) => row.id)).toEqual(["a-owner"])
    expect(await getChannel("b-owner")).toMatchObject({ success: false })
    expect(await getChannel("a-vendor")).toMatchObject({ success: false })
  })
})

describe("preview state and resource boundaries", () => {
  it("rejects typing before any database write or lookup", async () => {
    mocks.writeGuard.mockRejectedValue(new Error("Preview is read only."))
    expect(await setTyping("a-owner")).toMatchObject({ success: false, error: "Preview is read only." })
    expect(mocks.env).not.toHaveBeenCalled()
  })
  it("does not clean typing state while polling an audience-scoped read", async () => {
    database.sqlite.exec(`
      INSERT INTO channels (id,name,type,organization_id,project_id,audience,is_private) VALUES ('a-owner','Current','text','org-a','project-a','clients',1);
      INSERT INTO channel_members (id,channel_id,user_id,role) VALUES ('m','a-owner','owner-a','member');
      INSERT INTO typing_sessions (id,channel_id,user_id,started_at,expires_at) VALUES ('expired','a-owner','staff-a','2020-01-01','2020-01-02');
    `)
    expect(await getChannelUpdates("a-owner")).toMatchObject({ success: true })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM typing_sessions").get()).toEqual({ count: 1 })
  })
  it("rejects a task outside the preview before reading its private assignee responses", async () => {
    database.sqlite.exec(`
      CREATE TABLE schedule_tasks (id TEXT PRIMARY KEY,project_id TEXT);
      INSERT INTO schedule_tasks VALUES ('task-other','project-b');
      INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES ('other-owner','project-b','owner-a','client','2026-10-24');
    `)
    await expect(getScheduleTaskAssignees("task-other")).rejects.toThrow("Record not found")
    expect(mocks.resourceProject).toHaveBeenCalledWith("project-b")
  })
})
