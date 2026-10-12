import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  getCurrentUser: mocks.requireAuth,
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({
  isMissingNotificationTableError: () => false,
  queueSmsDelivery: vi.fn(),
}))

import {
  dismissReadNotifications,
  getNotificationCenter,
  setNotificationsDismissed,
} from "../notifications"
import {
  markChannelNotificationsRead,
  markCorrespondenceNotificationsRead,
  markThreadNotificationsRead,
} from "@/lib/notifications/clear-on-read"
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

function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  opened.sqlite.exec(`
    CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, event_type TEXT, project_id TEXT, source_type TEXT NOT NULL, source_id TEXT);
    CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, dismissed_at TEXT, read_at TEXT, created_at TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, created_at TEXT);
    INSERT INTO messages VALUES ('m1', 'c1', NULL, '2026-10-08T09:00:00Z');
    INSERT INTO messages VALUES ('m2', 'c1', NULL, '2026-10-08T10:00:00Z');
    INSERT INTO messages VALUES ('m3', 'c1', NULL, '2026-10-08T11:00:00Z');
    INSERT INTO messages VALUES ('r1', 'c1', 'm1', '2026-10-08T09:30:00Z');
    INSERT INTO messages VALUES ('other', 'c2', NULL, '2026-10-08T09:00:00Z');
    INSERT INTO notification_events VALUES ('e-m1', 'org-a', 'm1', '', '/dashboard/conversations/c1', 'normal', 'message.channel', NULL, 'message', 'm1');
    INSERT INTO notification_events VALUES ('e-m2', 'org-a', 'm2', '', '/dashboard/conversations/c1', 'normal', 'message.channel', NULL, 'message', 'm2');
    INSERT INTO notification_events VALUES ('e-m3', 'org-a', 'm3', '', '/dashboard/conversations/c1', 'normal', 'message.channel', NULL, 'message', 'm3');
    INSERT INTO notification_events VALUES ('e-r1', 'org-a', 'r1', '', '/dashboard/conversations/c1', 'normal', 'message.thread_reply', NULL, 'message', 'r1');
    INSERT INTO notification_events VALUES ('e-other', 'org-a', 'other', '', '/dashboard/conversations/c2', 'normal', 'message.channel', NULL, 'message', 'other');
    INSERT INTO notification_events VALUES ('e-pm', 'org-a', 'pm', '', '/dashboard/projects/p/messages?conversationId=x&messageId=pm1', 'normal', 'project_message', NULL, 'project_correspondence', 'pm1');
    INSERT INTO notification_events VALUES ('e-rfi', 'org-a', 'rfi', '', '/dashboard/rfis/1', 'normal', 'rfi.created', NULL, 'rfi', 'm1');
    INSERT INTO notification_recipients VALUES ('n-m1', 'e-m1', 'u1', 1, NULL, NULL, '2026-10-08T09:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-m2', 'e-m2', 'u1', 1, NULL, NULL, '2026-10-08T10:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-m3', 'e-m3', 'u1', 1, NULL, NULL, '2026-10-08T11:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-r1', 'e-r1', 'u1', 1, NULL, NULL, '2026-10-08T09:30:00Z');
    INSERT INTO notification_recipients VALUES ('n-other', 'e-other', 'u1', 1, NULL, NULL, '2026-10-08T09:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-pm', 'e-pm', 'u1', 1, NULL, NULL, '2026-10-08T09:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-rfi', 'e-rfi', 'u1', 1, NULL, NULL, '2026-10-08T09:00:00Z');
    INSERT INTO notification_recipients VALUES ('n-m1-u2', 'e-m1', 'u2', 1, NULL, NULL, '2026-10-08T09:00:00Z');
  `)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.requireAuth.mockResolvedValue({ id: "u1", role: "admin", organizationId: "org-a" })
  return opened
}

function readIds(db: CorrespondenceTestDatabase): readonly string[] {
  return db.sqlite
    .prepare("SELECT id FROM notification_recipients WHERE read_at IS NOT NULL ORDER BY id")
    .all()
    .flatMap((row) => (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string" ? [row.id] : []))
}

describe("reading clears the bell", () => {
  it("clears top-level channel messages up to what was seen, for this viewer only", async () => {
    database = open()
    await markChannelNotificationsRead(database.db, "u1", "c1", "2026-10-08T10:00:00Z")
    // m3 arrived after the cutoff, r1 is a thread reply, other channel and the
    // RFI that shares an id string stay unread, and u2 is untouched.
    expect(readIds(database)).toEqual(["n-m1", "n-m2"])
  })

  it("clears a thread's replies when the thread is opened", async () => {
    database = open()
    await markThreadNotificationsRead(database.db, "u1", "m1")
    expect(readIds(database)).toEqual(["n-m1", "n-r1"])
  })

  it("clears opened project messages", async () => {
    database = open()
    await markCorrespondenceNotificationsRead(database.db, "u1", ["pm1"])
    expect(readIds(database)).toEqual(["n-pm"])
  })
})

describe("Done, Undo and Clear read", () => {
  it("hides done items, restores them on undo, and clears read ones", async () => {
    database = open()
    expect(await setNotificationsDismissed(["n-m1", "n-m1-u2"], true)).toEqual({ success: true })
    let center = await getNotificationCenter()
    expect(center.success && center.data.items.map((item) => item.id)).not.toContain("n-m1")
    // Another person's row is never touched.
    expect(database.sqlite.prepare("SELECT dismissed_at FROM notification_recipients WHERE id='n-m1-u2'").get()).toEqual({ dismissed_at: null })

    await setNotificationsDismissed(["n-m1"], false)
    center = await getNotificationCenter()
    expect(center.success && center.data.items.map((item) => item.id)).toContain("n-m1")

    await markChannelNotificationsRead(database.db, "u1", "c1", "2026-10-08T10:00:00Z")
    await dismissReadNotifications()
    center = await getNotificationCenter()
    const ids = center.success ? center.data.items.map((item) => item.id) : []
    expect(ids).not.toContain("n-m2")
    expect(ids).toContain("n-m3")
  })

  it("rejects an empty or oversized selection", async () => {
    database = open()
    expect((await setNotificationsDismissed([], true)).success).toBe(false)
  })
})
