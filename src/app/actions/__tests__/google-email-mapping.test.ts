import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn() }))

import { updateUserGoogleEmail } from "../google-drive"
import { DEFAULT_DEPARTMENT_PROFILES } from "@/lib/department-profiles"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

const NOW = "2026-10-01T12:00:00.000Z"

let database: CorrespondenceTestDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

function migration(file: string): string {
  return readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll(
    "--> statement-breakpoint",
    ""
  )
}

/**
 * org-a (staff-a admin, owner-a) is connected to the example.test Workspace;
 * org-b (staff-b, owner-b) is a separate company.
 */
function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  const { sqlite } = opened
  sqlite.exec("ALTER TABLE users ADD COLUMN google_email TEXT")
  sqlite.exec(migration("0074_activity_events.sql"))
  sqlite.exec(migration("0203_organization_feature_settings.sql"))
  sqlite.exec(`
    CREATE TABLE google_auth (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
      service_account_key_encrypted TEXT NOT NULL, workspace_domain TEXT NOT NULL,
      shared_drive_id TEXT, shared_drive_name TEXT, connected_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO google_auth VALUES ('ga-a','org-a','enc','example.test',NULL,NULL,'staff-a','${NOW}','${NOW}');
    UPDATE users SET google_email = 'staff-b.mailbox@example.test' WHERE id = 'staff-b';
  `)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.requireAuth.mockResolvedValue({
    id: "staff-a",
    email: "staff-a@example.test",
    displayName: "Staff A",
    firstName: "Staff",
    lastName: "A",
    role: "admin",
    organizationId: "org-a",
    isActive: true,
  })
  return opened
}

function googleEmailOf(db: CorrespondenceTestDatabase, userId: string): unknown {
  const row: unknown = db.sqlite.prepare("SELECT google_email FROM users WHERE id = ?").get(userId)
  return typeof row === "object" && row !== null && "google_email" in row ? row.google_email : undefined
}

function activityCount(db: CorrespondenceTestDatabase): unknown {
  const row: unknown = db.sqlite.prepare("SELECT count(*) AS n FROM activity_events").get()
  return typeof row === "object" && row !== null && "n" in row ? row.n : undefined
}

describe("updateUserGoogleEmail", () => {
  it("refuses a user from another organization", async () => {
    database = open()
    const result = await updateUserGoogleEmail("owner-b", "owner-b.new@example.test")
    expect(result).toEqual({ success: false, error: "User not found in this organization" })
    expect(googleEmailOf(database, "owner-b")).toBeNull()
  })

  it("refuses an inactive member", async () => {
    database = open()
    database.sqlite.exec("UPDATE users SET is_active = 0 WHERE id = 'owner-a'")
    expect(await updateUserGoogleEmail("owner-a", "owner-a.new@example.test")).toMatchObject({ success: false })
  })

  it("refuses an address outside the connected Workspace domain", async () => {
    database = open()
    expect(await updateUserGoogleEmail("owner-a", "owner-a@attacker.test")).toMatchObject({ success: false })
    expect(await updateUserGoogleEmail("owner-a", "owner-a@sub.example.test")).toMatchObject({ success: false })
    expect(await updateUserGoogleEmail("owner-a", "not an email")).toMatchObject({ success: false })
    expect(googleEmailOf(database, "owner-a")).toBeNull()
  })

  it("refuses when the organization has no Workspace connected", async () => {
    database = open()
    database.sqlite.exec("DELETE FROM google_auth")
    expect(await updateUserGoogleEmail("owner-a", "owner-a.new@example.test")).toMatchObject({ success: false })
  })

  it("refuses another user's email or Google email, ignoring case", async () => {
    database = open()
    expect(await updateUserGoogleEmail("owner-a", "Staff-A@Example.test")).toEqual({
      success: false,
      error: "That address already belongs to another Compass user.",
    })
    // staff-b is in another org, but the mailbox identity is still taken.
    expect(await updateUserGoogleEmail("owner-a", "STAFF-B.mailbox@example.test")).toMatchObject({ success: false })
    expect(googleEmailOf(database, "owner-a")).toBeNull()
  })

  it("refuses a department sending mailbox", async () => {
    database = open()
    const departments = {
      ...DEFAULT_DEPARTMENT_PROFILES,
      H: { ...DEFAULT_DEPARTMENT_PROFILES.H, senderAddress: "office@example.test" },
    }
    database.sqlite
      .prepare("INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES (?,?,?,?)")
      .run("org-a", "department-profiles", JSON.stringify({ departments }), NOW)
    expect(await updateUserGoogleEmail("owner-a", "Office@example.test")).toEqual({
      success: false,
      error: "That address is a department's sending mailbox and can't be assigned to a person.",
    })
    expect(googleEmailOf(database, "owner-a")).toBeNull()
  })

  it("sets a valid address, then clears it, recording each change", async () => {
    database = open()
    expect(await updateUserGoogleEmail("owner-a", " Owner.A@Example.test ")).toEqual({ success: true })
    expect(googleEmailOf(database, "owner-a")).toBe("owner.a@example.test")
    const event: unknown = database.sqlite
      .prepare("SELECT organization_id, actor_user_id, category, action, entity_type, entity_id, metadata FROM activity_events")
      .get()
    expect(event).toMatchObject({
      organization_id: "org-a",
      actor_user_id: "staff-a",
      category: "account",
      action: "user.google_email_set",
      entity_type: "user",
      entity_id: "owner-a",
    })
    expect(event).toMatchObject({
      metadata: JSON.stringify({ previousGoogleEmail: null, googleEmail: "owner.a@example.test" }),
    })

    // Assigning the user's own login address is not a conflict.
    expect(await updateUserGoogleEmail("owner-a", "owner-a@example.test")).toEqual({ success: true })
    expect(await updateUserGoogleEmail("owner-a", null)).toEqual({ success: true })
    expect(googleEmailOf(database, "owner-a")).toBeNull()
    expect(activityCount(database)).toBe(3)
  })

  it("requires user:update permission", async () => {
    database = open()
    mocks.requireAuth.mockResolvedValue({ id: "owner-a", role: "client", organizationId: "org-a", isActive: true })
    expect(await updateUserGoogleEmail("owner-a", "owner.a@example.test")).toMatchObject({ success: false })
    expect(googleEmailOf(database, "owner-a")).toBeNull()
  })
})
