import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getTableName } from "drizzle-orm"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  deleteUser: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/auth-config", () => ({ isWorkOSConfigured: () => true }))
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { deleteUser: mocks.deleteUser } }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  completeAccountDeletion,
  getAccountDeletionRequestsForAdmin,
  startAccountDeletionProcessing,
} from "../account-deletion-admin"
import { PERSONAL_DATA_TABLES } from "@/lib/account-deletion"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

const NOW = "2026-10-01T12:00:00.000Z"
const PERSONAL_TABLE_NAMES = [
  ...new Set(PERSONAL_DATA_TABLES.map((table) => getTableName(table))),
]

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
 * owner-a (org-a) has a request; owner-b (org-b) has one the org-a admin
 * must never see. Both have one row in every personal-data table.
 */
function open(role = "admin"): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  const { sqlite } = opened
  for (const column of ["phone TEXT", "address TEXT", "avatar_url TEXT", "dashboard_desk_photo_url TEXT", "sidebar_desk_photo_url TEXT", "google_email TEXT"]) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN ${column}`)
  }
  sqlite.exec("UPDATE users SET phone = '555-0100', address = '1 Main St' WHERE id = 'owner-a'")
  sqlite.exec(migration("0197_account_deletion_requests.sql"))
  sqlite.exec(migration("0199_account_deletion_processing.sql"))
  // The real tables have more columns; deletion only touches user_id.
  for (const name of PERSONAL_TABLE_NAMES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${name}`)
    sqlite.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`)
    sqlite.exec(`INSERT INTO ${name} (id, user_id) VALUES ('${name}-a', 'owner-a'), ('${name}-b', 'owner-b')`)
  }
  sqlite.exec(`
    INSERT INTO account_deletion_requests (id, user_id, email_snapshot, display_name_snapshot, status, requested_at, updated_at) VALUES
      ('req-a', 'owner-a', 'owner-a@example.test', 'Owner A', 'pending', '${NOW}', '${NOW}'),
      ('req-b', 'owner-b', 'owner-b@example.test', 'Owner B', 'pending', '${NOW}', '${NOW}');
  `)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.requireAuth.mockResolvedValue({ id: "staff-a", role, organizationId: "org-a", isActive: true })
  mocks.deleteUser.mockResolvedValue(undefined)
  return opened
}

function row(db: CorrespondenceTestDatabase, sql: string): Record<string, unknown> {
  const result: unknown = db.sqlite.prepare(sql).get()
  if (typeof result !== "object" || result === null) throw new Error(`No row for: ${sql}`)
  return Object.fromEntries(Object.entries(result))
}

function personalRowsFor(db: CorrespondenceTestDatabase, userId: string): number {
  return PERSONAL_TABLE_NAMES.reduce((total, name) => {
    const { n } = row(db, `SELECT count(*) AS n FROM ${name} WHERE user_id = '${userId}'`)
    return total + (typeof n === "number" ? n : 0)
  }, 0)
}

async function startAndConfirm(db: CorrespondenceTestDatabase): Promise<void> {
  expect(await startAccountDeletionProcessing("req-a")).toEqual({ success: true })
  expect(row(db, "SELECT status FROM account_deletion_requests WHERE id = 'req-a'").status).toBe("processing")
}

describe("account deletion processing", () => {
  it("only shows admins the requests from their own organization", async () => {
    database = open()
    const requests = await getAccountDeletionRequestsForAdmin()
    expect(requests?.map((request) => request.id)).toEqual(["req-a"])
  })

  it("refuses people who can't manage user access", async () => {
    database = open("client")
    expect(await getAccountDeletionRequestsForAdmin()).toBeNull()
    expect(await startAccountDeletionProcessing("req-a")).toMatchObject({ success: false })
    expect(row(database, "SELECT status FROM account_deletion_requests WHERE id = 'req-a'").status).toBe("pending")
  })

  it("can't reach another organization's request", async () => {
    database = open()
    expect(await startAccountDeletionProcessing("req-b")).toEqual({ success: false, error: "Request not found." })
  })

  it("records who started processing and only starts a pending request once", async () => {
    database = open()
    await startAndConfirm(database)
    expect(row(database, "SELECT processing_started_by FROM account_deletion_requests WHERE id = 'req-a'").processing_started_by).toBe("staff-a")
    expect(await startAccountDeletionProcessing("req-a")).toMatchObject({ success: false })
  })

  it("won't complete a request that hasn't been started or isn't confirmed", async () => {
    database = open()
    expect(await completeAccountDeletion("req-a", "DELETE")).toMatchObject({ success: false })
    await startAndConfirm(database)
    expect(await completeAccountDeletion("req-a", "delete please")).toMatchObject({ success: false })
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it("deletes the identity and personal data, de-identifies the user and closes the request", async () => {
    database = open()
    await startAndConfirm(database)
    expect(await completeAccountDeletion("req-a", "DELETE")).toEqual({ success: true })

    expect(mocks.deleteUser).toHaveBeenCalledWith("owner-a")
    expect(personalRowsFor(database, "owner-a")).toBe(0)
    expect(personalRowsFor(database, "owner-b")).toBe(PERSONAL_TABLE_NAMES.length)
    expect(row(database, "SELECT * FROM users WHERE id = 'owner-a'")).toMatchObject({
      email: "deleted+owner-a@deleted.invalid",
      first_name: null,
      last_name: null,
      display_name: "Deleted user",
      phone: null,
      address: null,
      is_active: 0,
    })
    expect(row(database, "SELECT * FROM account_deletion_requests WHERE id = 'req-a'")).toMatchObject({
      status: "completed",
      completed_by: "staff-a",
      email_snapshot: null,
      display_name_snapshot: null,
    })
    // Retained records keep pointing at the de-identified row.
    expect(row(database, "SELECT count(*) AS n FROM project_members WHERE user_id = 'owner-a'").n).toBe(1)
  })

  it("treats an identity WorkOS already deleted as done", async () => {
    database = open()
    await startAndConfirm(database)
    mocks.deleteUser.mockRejectedValue({ status: 404 })
    expect(await completeAccountDeletion("req-a", "DELETE")).toEqual({ success: true })
    expect(row(database, "SELECT status FROM account_deletion_requests WHERE id = 'req-a'").status).toBe("completed")
  })

  it("changes nothing in Compass when WorkOS fails", async () => {
    database = open()
    await startAndConfirm(database)
    mocks.deleteUser.mockRejectedValue(new Error("WorkOS unavailable"))
    expect(await completeAccountDeletion("req-a", "DELETE")).toMatchObject({ success: false })
    expect(personalRowsFor(database, "owner-a")).toBe(PERSONAL_TABLE_NAMES.length)
    expect(row(database, "SELECT email FROM users WHERE id = 'owner-a'").email).toBe("owner-a@example.test")
    expect(row(database, "SELECT status FROM account_deletion_requests WHERE id = 'req-a'").status).toBe("processing")
  })

  it("rolls back everything when the database batch fails", async () => {
    database = open()
    await startAndConfirm(database)
    database.failures.failNextMatching("update \"account_deletion_requests\"")
    expect(await completeAccountDeletion("req-a", "DELETE")).toMatchObject({ success: false })
    expect(personalRowsFor(database, "owner-a")).toBe(PERSONAL_TABLE_NAMES.length)
    expect(row(database, "SELECT display_name FROM users WHERE id = 'owner-a'").display_name).toBe("Owner A")
    expect(row(database, "SELECT status FROM account_deletion_requests WHERE id = 'req-a'").status).toBe("processing")
  })

  it("doesn't let an admin complete their own deletion", async () => {
    database = open()
    database.sqlite.exec(`INSERT INTO account_deletion_requests (id, user_id, status, requested_at, updated_at) VALUES ('req-self', 'staff-a', 'processing', '${NOW}', '${NOW}')`)
    expect(await completeAccountDeletion("req-self", "DELETE")).toMatchObject({ success: false })
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
})
