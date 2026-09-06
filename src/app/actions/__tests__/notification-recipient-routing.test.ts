import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getCurrentUser: mocks.requireAuth,
}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({
  isMissingNotificationTableError: () => false,
  queueSmsDelivery: vi.fn(),
}))

import { getNotificationCenter } from "../notifications"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

describe("notification bell recipient routing", () => {
  it("uses the signed-in recipient identity for an existing shared vendor notification", async () => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(`
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, title TEXT, body TEXT, href TEXT, priority TEXT, event_type TEXT, project_id TEXT);
      CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, dismissed_at TEXT, read_at TEXT, created_at TEXT);
      INSERT INTO notification_events VALUES ('event-a', 'New project message', 'Message saved', '/preview/projects/project-a/sub-vendor/conversations/vendor-channel', 'normal', 'message.channel', 'project-a');
      INSERT INTO notification_recipients VALUES ('recipient-staff', 'event-a', 'staff-a', 1, NULL, NULL, '2026-09-06T00:00:00Z');
      INSERT INTO notification_recipients VALUES ('recipient-vendor', 'event-a', 'owner-a', 1, NULL, NULL, '2026-09-06T00:00:00Z');
    `)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1 } })
    mocks.requireAuth.mockResolvedValue({ id: "staff-a", role: "admin" })
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
    })
    expect(await getNotificationCenter()).toMatchObject({
      success: true,
      data: { unreadCount: 0, items: [] },
    })
  })
})
