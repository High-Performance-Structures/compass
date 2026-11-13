import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { resolveIntakeAssignee } from "@/lib/domain/project/intake"
import { insertRow } from "@/test/migrated-database"

/*
 * The intake project manager becomes a job contact, so it must be active
 * staff from the directory; a typed name is refused.
 */

let sqlite: ReturnType<typeof migratedDb>["sqlite"]
let db: ReturnType<typeof migratedDb>["db"]

beforeEach(() => {
  ;({ sqlite, db } = migratedDb())
  insertRow(sqlite, "organizations", { id: "org-1" })
  insertRow(sqlite, "users", { id: "user-1", email: "pm@example.com", display_name: "Pat Manager", is_active: 1 })
  insertRow(sqlite, "organization_members", { id: "m1", organization_id: "org-1", user_id: "user-1" })
})

afterEach(() => sqlite.close())

describe("intake project manager", () => {
  it("accepts an active staff member", async () => {
    const result = await resolveIntakeAssignee(db, { organizationId: "org-1", assignedTo: "Pat Manager" })
    expect(result).toMatchObject({ ok: true, projectManagerName: "Pat Manager" })
  })

  it("refuses a typed name that is not staff", async () => {
    const result = await resolveIntakeAssignee(db, { organizationId: "org-1", assignedTo: "Someone Typed" })
    expect(result).toEqual({ ok: false, error: "Choose the project manager from active staff. Add new staff in Contacts first." })
  })

  it("allows no project manager", async () => {
    expect(await resolveIntakeAssignee(db, { organizationId: "org-1", assignedTo: "" })).toMatchObject({ ok: true, assignee: null })
  })
})
