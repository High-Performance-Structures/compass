import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { internalContacts, organizationMembers, users } from "@/db/schema"
import { resolveIntakeAssignee } from "@/lib/domain/project/intake"

/*
 * The intake project manager becomes a job contact, so it must be active
 * staff from the directory; a typed name is refused.
 */

const TABLES: readonly SQLiteTable[] = [users, organizationMembers, internalContacts]
let sqlite: InstanceType<typeof Database>

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) {
    const config = getTableConfig(table)
    sqlite.exec(`CREATE TABLE ${config.name} (${config.columns.map((column) => `"${column.name}"`).join(", ")})`)
  }
  sqlite.prepare("INSERT INTO users (id, email, display_name, is_active) VALUES (?, ?, ?, 1)").run("user-1", "pm@example.com", "Pat Manager")
  sqlite.prepare("INSERT INTO organization_members (id, organization_id, user_id) VALUES (?, ?, ?)").run("m1", "org-1", "user-1")
})

afterEach(() => sqlite.close())

describe("intake project manager", () => {
  it("accepts an active staff member", async () => {
    const result = await resolveIntakeAssignee(drizzle(sqlite), { organizationId: "org-1", assignedTo: "Pat Manager" })
    expect(result).toMatchObject({ ok: true, projectManagerName: "Pat Manager" })
  })

  it("refuses a typed name that is not staff", async () => {
    const result = await resolveIntakeAssignee(drizzle(sqlite), { organizationId: "org-1", assignedTo: "Someone Typed" })
    expect(result).toEqual({ ok: false, error: "Choose the project manager from active staff. Add new staff in Contacts first." })
  })

  it("allows no project manager", async () => {
    expect(await resolveIntakeAssignee(drizzle(sqlite), { organizationId: "org-1", assignedTo: "" })).toMatchObject({ ok: true, assignee: null })
  })
})
