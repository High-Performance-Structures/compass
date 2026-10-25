import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, openCorrespondenceTestDatabase, insertConversation, insertGrant, insertMessage, insertParticipant, type CorrespondenceTestDatabase } from "../../../__tests__/helpers/correspondence-core"
import { AUDIENCE_SCOPE_HEADER, audienceScopeFromUrl, parseAudienceScope, scopedAudienceHref } from "@/lib/project-audience-request"

const mocks = vi.hoisted(() => ({ actor: vi.fn(), environment: vi.fn(), headers: vi.fn(), permission: vi.fn(), audit: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.actor }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.environment }))
vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.permission }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.audit }))
import { resolveProjectAudienceViewer, assertAudiencePreviewWriteAllowed, recordProjectAudiencePreviewVisit } from "@/lib/project-audience-viewer"
import { audienceReadCacheControl, assertAudienceResourceProject, isAudiencePreviewRequest } from "@/lib/project-audience-request-server"
import { getNotificationPreferences } from "@/app/actions/notifications"
import { correspondenceContext } from "@/lib/correspondence/access"
import { listCorrespondence, readCorrespondence } from "@/lib/correspondence/read"

let database: CorrespondenceTestDatabase
let scope: string | null
beforeEach(() => {
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec("CREATE TABLE project_route_aliases (source_project_id TEXT PRIMARY KEY,target_project_id TEXT)")
  for (const column of ["phone", "address", "avatar_url", "dashboard_desk_photo_url", "sidebar_desk_photo_url", "google_email", "last_login_at"]) database.sqlite.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`)
  database.sqlite.exec("ALTER TABLE organizations ADD COLUMN logo_url TEXT")
  database.sqlite.exec("ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT")
  database.sqlite.exec(`CREATE TABLE project_access_invitations (id TEXT, organization_id TEXT, project_id TEXT, project_contact_id TEXT, email TEXT, role TEXT,
    status TEXT, workos_invitation_id TEXT, workos_expires_at TEXT, email_provider TEXT, email_provider_message_id TEXT, email_error TEXT,
    invited_by TEXT, invited_at TEXT, accepted_by TEXT, accepted_at TEXT, created_at TEXT, updated_at TEXT)`)
  mocks.actor.mockResolvedValue(context(database, "staff-a", "project-a").user)
  mocks.environment.mockResolvedValue({ env: { DB: database.d1, COMPASS_CORRESPONDENCE_ENABLED: "true" } })
  mocks.permission.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: "owner-a" })
  mocks.headers.mockImplementation(async () => new Headers(scope ? { [AUDIENCE_SCOPE_HEADER]: scope } : {}))
})
afterEach(() => { database.close(); vi.clearAllMocks() })

describe("external viewer resolution", () => {
  it("selects an assigned external account without changing staff authentication", async () => {
    const resolved = await resolveProjectAudienceViewer("project-a", "owner")
    expect(resolved.actor.id).toBe("staff-a")
    expect(resolved.viewer?.id).toBe("owner-a")
    expect(resolved.isPreview).toBe(true)
    expect(await isAudiencePreviewRequest()).toBe(true)
    expect(resolved.previewOptions.map((person) => person.id)).not.toContain("staff-a")
    expect(mocks.audit).not.toHaveBeenCalled()
    await recordProjectAudiencePreviewVisit(resolved)
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    await resolveProjectAudienceViewer("project-a", "owner")
    expect(mocks.audit).toHaveBeenCalledTimes(1)
  })
  it("normalizes an existing project alias in both the request scope and explicit loader input", async () => {
    database.sqlite.exec("INSERT INTO project_route_aliases VALUES ('legacy-a','project-a')")
    scope = JSON.stringify({ projectId: "legacy-a", audience: "owner", targetUserId: "owner-a" })
    const resolved = await resolveProjectAudienceViewer("legacy-a", "owner")
    expect(resolved.projectId).toBe("project-a")
    expect(resolved.viewer?.id).toBe("owner-a")
    expect((await resolveProjectAudienceViewer("project-a", "owner")).viewer?.id).toBe("owner-a")
  })
  it("fails closed for cyclic aliases", async () => {
    database.sqlite.exec("INSERT INTO project_route_aliases VALUES ('cycle-a','cycle-b'),('cycle-b','cycle-a')")
    scope = JSON.stringify({ projectId: "cycle-a", audience: "owner", targetUserId: "owner-a" })
    await expect(resolveProjectAudienceViewer("cycle-a", "owner")).rejects.toThrow("Project not found")
  })
  it("requires a separate preview permission", async () => {
    mocks.permission.mockResolvedValue(false)
    await expect(resolveProjectAudienceViewer("project-a", "owner")).rejects.toThrow("permission")
  })
  it("returns placeholder account settings without reading the selected person's private preferences", async () => {
    const result = await getNotificationPreferences()
    expect(result.success).toBe(true)
    expect(result.success && result.data.smsPhoneNumber).toBeNull()
    expect(result.success && result.data.smsConsentPhoneNumber).toBeNull()
    expect(result.success && result.data.timeZone).toBe("America/Denver")
  })
  it("never substitutes staff identity when no person was selected", async () => {
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: null })
    expect((await resolveProjectAudienceViewer("project-a", "owner")).viewer).toBeNull()
    await expect(correspondenceContext("project-a", "read")).rejects.toThrow("Select a person")
  })
  it("lists people invited who haven't accepted and previews them by their contact", async () => {
    database.sqlite.exec(`
      INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, company_name, active)
        VALUES ('c-new','project-a','owner','New Owner','new@home.test','New Owner LLC',1),
               ('c-sub','project-a','subcontractor','New Sub','sub@trade.test','Trade Co',1);
      INSERT INTO project_access_invitations (id, organization_id, project_id, project_contact_id, email, role, status, invited_by, invited_at, created_at, updated_at)
        VALUES ('inv-owner','org-a','project-a','c-new','new@home.test','client','sent','staff-a','2026-10-24T00:00:00Z','x','x'),
               ('inv-sub','org-a','project-a','c-sub','sub@trade.test','subcontractor','sent','staff-a','2026-10-24T00:00:00Z','x','x'),
               ('inv-done','org-a','project-a','c-new','old@home.test','client','expired','staff-a','2026-10-01T00:00:00Z','x','x');
    `)
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: null })
    const listed = await resolveProjectAudienceViewer("project-a", "owner")
    expect(listed.previewOptions.filter((person) => person.invited)).toEqual([
      { id: "invite:inv-owner", name: "New Owner", email: "new@home.test", companyName: "New Owner LLC", invited: true },
    ])
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: "invite:inv-owner" })
    const previewed = await resolveProjectAudienceViewer("project-a", "owner")
    expect(previewed.viewer).toMatchObject({ id: "invite:inv-owner", email: "new@home.test", displayName: "New Owner", role: "client" })
    await expect(correspondenceContext("project-a", "read")).rejects.toThrow("hasn't accepted")
    // A vendor's invitation doesn't open the owner workspace.
    await expect(resolveProjectAudienceViewer("project-a", "owner", "invite:inv-sub")).rejects.toThrow()
    await expect(resolveProjectAudienceViewer("project-a", "owner", "invite:inv-done")).rejects.toThrow()
  })
  it("rejects removed, inactive, internal and wrong-audience targets", async () => {
    for (const id of ["staff-a", "owner-b", "missing-person"]) {
      await expect(resolveProjectAudienceViewer("project-a", "owner", id)).rejects.toThrow()
    }
    database.sqlite.exec("UPDATE users SET is_active=0 WHERE id='owner-a'")
    await expect(resolveProjectAudienceViewer("project-a", "owner", "owner-a")).rejects.toThrow()
  })
  it("fails closed across projects and on revoked assignments", async () => {
    await expect(resolveProjectAudienceViewer("project-b", "owner")).rejects.toThrow("scope")
    database.sqlite.exec("DELETE FROM project_members WHERE user_id='owner-a' AND project_id='project-a'")
    await expect(resolveProjectAudienceViewer("project-a", "owner")).rejects.toThrow()
  })
  it("keeps real external access and rejects impersonation by external accounts", async () => {
    mocks.actor.mockResolvedValue(context(database, "owner-a", "project-a").user)
    await expect(resolveProjectAudienceViewer("project-a", "owner")).rejects.toThrow("unavailable")
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: null })
    const resolved = await resolveProjectAudienceViewer("project-a", "owner")
    expect(resolved.viewer?.id).toBe("owner-a")
    expect(resolved.isPreview).toBe(false)
    expect(await isAudiencePreviewRequest()).toBe(false)
    await recordProjectAudiencePreviewVisit(resolved)
    expect(mocks.audit).not.toHaveBeenCalled()
    await expect(assertAudiencePreviewWriteAllowed()).resolves.toBeUndefined()
  })
  it("rejects preview writes while ordinary staff requests remain independent", async () => {
    await expect(assertAudiencePreviewWriteAllowed()).rejects.toThrow("read only")
    scope = null
    await expect(assertAudiencePreviewWriteAllowed()).resolves.toBeUndefined()
  })
  it("classifies write protection by the project organization rather than the active shell role", async () => {
    mocks.actor.mockResolvedValue({ ...context(database, "staff-a", "project-a").user, role: "client", organizationId: "org-b" })
    await expect(assertAudiencePreviewWriteAllowed()).rejects.toThrow("read only")
    mocks.actor.mockResolvedValue({ ...context(database, "owner-a", "project-a").user, role: "admin", organizationId: "org-b" })
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: null })
    await expect(assertAudiencePreviewWriteAllowed()).resolves.toBeUndefined()
  })
  it("does not allow a resource to borrow another project's membership", async () => {
    await expect(assertAudienceResourceProject("project-a")).resolves.toBeUndefined()
    await expect(assertAudienceResourceProject("project-b")).rejects.toThrow("Record not found")
  })
  it("keeps preview file responses uncached without changing ordinary staff downloads", async () => {
    expect(await audienceReadCacheControl()).toBe("private, no-store")
    scope = null
    expect(await audienceReadCacheControl()).toBe("private, max-age=300")
  })
  it("uses identical message grants for real owner and selected preview without drafts or read mutations", async () => {
    insertConversation(database.sqlite, { id: "thread", projectId: "project-a" })
    insertParticipant(database.sqlite, { id: "staff-member", conversationId: "thread", userId: "staff-a", role: "staff" })
    insertParticipant(database.sqlite, { id: "owner-member", conversationId: "thread", userId: "owner-a", role: "owner" })
    insertMessage(database.sqlite, { id: "shared", conversationId: "thread", authorUserId: "staff-a", body: "Owner visible" })
    insertMessage(database.sqlite, { id: "private", conversationId: "thread", authorUserId: "staff-a", body: "Internal body" })
    insertGrant(database.sqlite, { id: "owner-grant", messageId: "shared", userId: "owner-a" })
    insertGrant(database.sqlite, { id: "staff-grant", messageId: "private", userId: "staff-a" })
    const preview = await correspondenceContext("project-a", "read")
    const previewDetail = await readCorrespondence(preview, "thread")
    mocks.actor.mockResolvedValue(context(database, "owner-a", "project-a").user)
    scope = JSON.stringify({ projectId: "project-a", audience: "owner", targetUserId: null })
    const live = await correspondenceContext("project-a", "read")
    expect((await listCorrespondence(preview)).map((row) => row.id)).toEqual((await listCorrespondence(live)).map((row) => row.id))
    expect(previewDetail.messages.map((message) => message.id)).toEqual((await readCorrespondence(live, "thread")).messages.map((message) => message.id))
    expect(JSON.stringify(previewDetail)).not.toContain("Internal body")
    expect(previewDetail.draft).toBeNull()
    expect(database.sqlite.prepare("SELECT opened_at FROM correspondence_recipients WHERE id='owner-grant'").get()).toEqual({ opened_at: null })
  })
})

describe("preview request isolation", () => {
  it("derives project and person from an explicit URL and preserves download scope", () => {
    const current = audienceScopeFromUrl(new URL("https://example.test/preview/projects/project-a/owner/conversations?previewAs=owner-a"))
    if (!current) throw new Error("Expected scope")
    const download = scopedAudienceHref("/api/correspondence/attachments/file?projectId=project-a", current)
    expect(audienceScopeFromUrl(new URL(download, "https://example.test"))).toEqual(current)
    expect(scopedAudienceHref("/preview/projects/project-a/owner/schedule", current)).toContain("previewAs=owner-a")
    expect(scopedAudienceHref("/dashboard", current)).toBe("/dashboard")
    expect(scopedAudienceHref("https://outside.test/file", current)).toBe("https://outside.test/file")
  })
  it("rejects malformed scope and does not propagate identity across projects", () => {
    expect(() => parseAudienceScope('{"audience":"staff"}')).toThrow()
    expect(scopedAudienceHref("/preview/projects/project-b/owner", { projectId: "project-a", audience: "owner", targetUserId: "owner-a" })).not.toContain("previewAs")
  })
})
