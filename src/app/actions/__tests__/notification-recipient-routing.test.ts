vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  viewerContact: vi.fn(),
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  assertProjectAccess: vi.fn(),
}))
vi.mock("@/lib/project-audience-viewer-contact", () => ({ getProjectAudienceViewerContact: mocks.viewerContact }))
beforeEach(() => mocks.viewerContact.mockResolvedValue(null))

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getCurrentUser: mocks.requireAuth,
}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({
  isMissingNotificationTableError: () => false,
  queueSmsDelivery: vi.fn(),
}))

import {
  getNotificationCenter,
  markAllNotificationsRead,
} from "../notifications"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null
const externalWorkspaceScopes: ReadonlyArray<{
  readonly audience: "sub_vendor" | "owner"
  readonly projectRole: "subcontractor" | "client"
}> = [
  { audience: "sub_vendor", projectRole: "subcontractor" },
  { audience: "owner", projectRole: "client" },
]

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

describe("notification bell recipient routing", () => {
  it("uses the signed-in recipient identity for an existing shared vendor notification", async () => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(`
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, event_type TEXT, project_id TEXT);
      CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, dismissed_at TEXT, read_at TEXT, created_at TEXT);
      INSERT INTO notification_events VALUES ('event-a', 'org-a', 'New project message', 'Message saved', '/preview/projects/project-a/sub-vendor/conversations/vendor-channel', 'normal', 'message.channel', 'project-a');
      INSERT INTO notification_events VALUES ('event-other-org', 'org-b', 'Other organization', 'Must stay hidden', '/dashboard/projects/project-b', 'normal', 'rfi.updated', 'project-b');
      INSERT INTO notification_recipients VALUES ('recipient-staff', 'event-a', 'staff-a', 1, NULL, NULL, '2026-09-06T00:00:00Z');
      INSERT INTO notification_recipients VALUES ('recipient-staff-other-org', 'event-other-org', 'staff-a', 1, NULL, NULL, '2026-09-06T01:00:00Z');
      INSERT INTO notification_recipients VALUES ('recipient-vendor', 'event-a', 'owner-a', 1, NULL, NULL, '2026-09-06T00:00:00Z');
      ALTER TABLE notification_events ADD COLUMN source_type TEXT NOT NULL DEFAULT 'message';
    `)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1 } })
    mocks.requireAuth.mockResolvedValue({
      id: "staff-a",
      role: "admin",
      organizationId: "org-a",
    })
    const staff = await getNotificationCenter()
    expect(staff).toMatchObject({
      success: true,
      data: {
        unreadCount: 1,
        items: [
          {
            id: "recipient-staff",
            href: "/dashboard/conversations/vendor-channel",
          },
        ],
      },
    })
    mocks.requireAuth.mockResolvedValue({
      id: "owner-a",
      role: "subcontractor",
      organizationId: "org-a",
    })
    const vendor = await getNotificationCenter()
    expect(vendor).toMatchObject({
      success: true,
      data: {
        unreadCount: 1,
        items: [
          {
            id: "recipient-vendor",
            href: "/preview/projects/project-a/sub-vendor/conversations/vendor-channel",
          },
        ],
      },
    })
    mocks.requireAuth.mockResolvedValue({
      id: "separate-owner",
      role: "client",
      organizationId: "org-a",
    })
    expect(await getNotificationCenter()).toMatchObject({
      success: true,
      data: { unreadCount: 0, items: [] },
    })
  })

  it.each(externalWorkspaceScopes)(
    "keeps the $audience workspace notification center and read state inside the active project",
    async ({ audience, projectRole }) => {
      database = openCorrespondenceTestDatabase()
      database.sqlite.exec(`
        CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, event_type TEXT, project_id TEXT);
        CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, dismissed_at TEXT, read_at TEXT, created_at TEXT);
        INSERT INTO notification_events VALUES ('event-current', 'org-a', 'Current project', 'Visible', '/dashboard/projects/project-a', 'normal', 'task.assigned', 'project-a');
        INSERT INTO notification_events VALUES ('event-other-project', 'org-a', 'Other project', 'Must stay hidden', '/dashboard/projects/project-b', 'normal', 'rfi.updated', 'project-b');
        INSERT INTO notification_events VALUES ('event-other-org', 'org-b', 'Other workspace', 'Must stay hidden', '/dashboard/projects/project-c', 'normal', 'rfi.updated', 'project-c');
        INSERT INTO notification_recipients VALUES ('recipient-current', 'event-current', 'external-a', 1, NULL, NULL, '2026-09-07T10:00:00Z');
        INSERT INTO notification_recipients VALUES ('recipient-other-project', 'event-other-project', 'external-a', 1, NULL, NULL, '2026-09-07T09:00:00Z');
        INSERT INTO notification_recipients VALUES ('recipient-other-org', 'event-other-org', 'external-a', 1, NULL, NULL, '2026-09-07T08:00:00Z');
        INSERT INTO project_members VALUES ('member-a', 'project-a', 'external-a', '${projectRole}', '2026-09-01T00:00:00Z');
        ALTER TABLE notification_events ADD COLUMN source_type TEXT NOT NULL DEFAULT 'message';
    `)
      mocks.getCloudflareContext.mockResolvedValue({
        env: { DB: database.d1 },
      })
      mocks.requireAuth.mockResolvedValue({
        id: "external-a",
        role: projectRole,
        organizationId: "org-a",
      })
      mocks.assertProjectAccess.mockResolvedValue({
        id: "project-a",
        organizationId: "org-a",
      })
      const scope = { projectId: "project-a", audience }

      expect(await getNotificationCenter(scope)).toMatchObject({
        success: true,
        data: {
          unreadCount: 1,
          items: [{ id: "recipient-current", projectId: "project-a" }],
        },
      })

      await expect(markAllNotificationsRead(scope)).resolves.toEqual({
        success: true,
      })
      const readState = database.sqlite
        .prepare(
          "SELECT id, read_at AS readAt FROM notification_recipients ORDER BY id"
        )
        .all()
      expect(readState).toEqual([
        {
          id: "recipient-current",
          readAt: expect.any(String),
        },
        { id: "recipient-other-org", readAt: null },
        { id: "recipient-other-project", readAt: null },
      ])
    }
  )

  it("fails closed when an external account requests the other audience or a project outside the active organization", async () => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(`
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, event_type TEXT, project_id TEXT);
      CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, dismissed_at TEXT, read_at TEXT, created_at TEXT);
      INSERT INTO project_members VALUES ('member-a', 'project-a', 'external-a', 'subcontractor', '2026-09-01T00:00:00Z');
      ALTER TABLE notification_events ADD COLUMN source_type TEXT NOT NULL DEFAULT 'message';
    `)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1 } })
    mocks.requireAuth.mockResolvedValue({
      id: "external-a",
      role: "subcontractor",
      organizationId: "org-a",
    })
    mocks.assertProjectAccess.mockResolvedValue({
      id: "project-a",
      organizationId: "org-a",
    })

    await expect(
      getNotificationCenter({ projectId: "project-a", audience: "owner" })
    ).resolves.toEqual({ success: false, error: "Project not found" })

    mocks.assertProjectAccess.mockResolvedValue({
      id: "project-a",
      organizationId: "org-b",
    })
    await expect(
      getNotificationCenter({
        projectId: "project-a",
        audience: "sub_vendor",
      })
    ).resolves.toEqual({ success: false, error: "Project not found" })
  })
})

describe("vendor RFI notification privacy", () => {
  it("excludes another company's RFI title and unread count even when an old notification grant exists", async () => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec("ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT")
    database.sqlite.exec(readFileSync("drizzle/0140_project_source_record_participants.sql", "utf8"))
    database.sqlite.exec(`
      CREATE TABLE project_rfis (id TEXT PRIMARY KEY,project_id TEXT,source_record_id TEXT);
      INSERT INTO project_rfis VALUES ('own-rfi','project-a',NULL),('other-rfi','project-a',NULL);
      INSERT INTO project_contacts (id,project_id,contact_type,display_name,vendor_id,active) VALUES ('vendor-contact','project-a','supplier','Own vendor','vendor-a',1);
      UPDATE project_members SET role='supplier' WHERE user_id='owner-a' AND project_id='project-a';
      INSERT INTO project_source_record_participants (id,organization_id,project_id,source_record_type,source_record_id,source_participant_id,participant_role,capabilities_json,project_contact_id,identity_status,membership_status,review_status,active,created_at,updated_at)
        VALUES ('p','org-a','project-a','rfi','own-rfi','p','recipient','["rfi.view"]','vendor-contact','matched','active','reviewed',1,'2026-10-24','2026-10-24');
      CREATE TABLE notification_events (id TEXT PRIMARY KEY,organization_id TEXT,title TEXT,body TEXT,href TEXT,priority TEXT,event_type TEXT,project_id TEXT,source_type TEXT,source_id TEXT);
      CREATE TABLE notification_recipients (id TEXT PRIMARY KEY,event_id TEXT,user_id TEXT,in_app INTEGER,dismissed_at TEXT,read_at TEXT,created_at TEXT);
      INSERT INTO notification_events VALUES ('own','org-a','Own RFI','Visible','/preview/projects/project-a/sub-vendor/rfis','normal','rfi.updated','project-a','rfi','own-rfi'),('other','org-a','Other company private RFI','Private','/preview/projects/project-a/sub-vendor/rfis','normal','rfi.updated','project-a','rfi','other-rfi');
      INSERT INTO notification_recipients VALUES ('own-recipient','own','owner-a',1,NULL,NULL,'2026-10-24'),('old-other-recipient','other','owner-a',1,NULL,NULL,'2026-10-24');
    `)
    mocks.requireAuth.mockResolvedValue({ id: "owner-a", email: "owner-a@example.test", role: "supplier", organizationId: "org-a" })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1 } })
    mocks.assertProjectAccess.mockResolvedValue({ id: "project-a", organizationId: "org-a" })
    mocks.viewerContact.mockResolvedValue({ id: "vendor-contact", vendorId: "vendor-a", contactType: "supplier" })
    const result = await getNotificationCenter({ projectId: "project-a", audience: "sub_vendor" })
    expect(result).toMatchObject({ success: true, data: { unreadCount: 1, items: [{ id: "own-recipient" }] } })
    expect(JSON.stringify(result)).not.toContain("Other company private RFI")
    expect(database.sqlite.prepare("SELECT read_at FROM notification_recipients WHERE id='own-recipient'").get()).toEqual({ read_at: null })
  })
})
