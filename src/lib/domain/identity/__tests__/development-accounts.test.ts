import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { loadProjectTaskAssigneeOptions } from "@/lib/domain/contacts/assignees"
import { loadDirectorySummary } from "@/lib/domain/contacts/directory-page"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { applySageEmployeeDirectory, staffSageLinkOverview } from "@/lib/sage/employee-directory-sync"
import type { Db } from "@/lib/server/action-context"

import { developmentAccountUserIds, setDevelopmentAccount } from "../development-accounts"
import { activeStaff } from "../reads"

/*
 * Development accounts against every migration replayed on SQLite: the tag
 * keeps the person's role and access, and takes them out of staff pickers,
 * the staff count and Sage employee linking.
 */

const NOW = "2026-11-13T12:00:00.000Z"
const ORG = "org-a"
const OTHER_ORG = "org-b"
const GUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

let sqlite: ReturnType<typeof migratedDatabase>
let d1: D1Database
let db: Db

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, created_at, updated_at) VALUES
      ('${ORG}', 'Acme Builders', 'acme', 'internal', '${NOW}', '${NOW}'),
      ('${OTHER_ORG}', 'Other Co', 'other', 'internal', '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES
      ('u-staff', 'staff@acme.test', 'Sam Staff', 'office', '${NOW}', '${NOW}'),
      ('u-dev', 'dev@acme.test', 'Dee Dev', 'admin', '${NOW}', '${NOW}'),
      ('u-bot', 'bot@acme.test', 'Build Bot', 'office', '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('m-staff', '${ORG}', 'u-staff', 'office', '${NOW}'),
      ('m-dev', '${ORG}', 'u-dev', 'admin', '${NOW}'),
      ('m-bot', '${ORG}', 'u-bot', 'office', '${NOW}'),
      ('m-dev-other', '${OTHER_ORG}', 'u-dev', 'admin', '${NOW}');
    INSERT INTO internal_contacts (id, organization_id, user_id, name, email, source_system, active, created_at, updated_at) VALUES
      ('ic-staff', '${ORG}', 'u-staff', 'Sam Staff', 'staff@acme.test', 'compass_user', 1, '${NOW}', '${NOW}'),
      ('ic-dev', '${ORG}', 'u-dev', 'Dee Dev', 'dev@acme.test', 'compass_user', 1, '${NOW}', '${NOW}'),
      ('ic-unlinked', '${ORG}', NULL, 'No Login', NULL, 'manual', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES
      ('p1', 'Test Job', '${ORG}', '${NOW}');
  `)
  // @ts-expect-error The test binding implements only what drizzle's D1 driver and the batch calls use.
  d1 = d1Over(sqlite)
  db = getDb(d1)
})

async function tag(userId: string, organizationId = ORG): Promise<void> {
  const result = await setDevelopmentAccount(db, { organizationId, userId, developmentAccount: true })
  expect(result.success).toBe(true)
}

function memberRole(id: string): string {
  const row: unknown = sqlite.prepare("SELECT role FROM organization_members WHERE id = ?").get(id)
  return typeof row === "object" && row !== null ? String(Reflect.get(row, "role")) : ""
}

describe("development accounts", () => {
  it("tags and clears per company without changing the role", async () => {
    await tag("u-dev")
    expect([...(await developmentAccountUserIds(db, ORG))]).toEqual(["u-dev"])
    // The same person in another company is not tagged there.
    expect((await developmentAccountUserIds(db, OTHER_ORG)).size).toBe(0)
    expect(memberRole("m-dev")).toBe("admin")

    const again = await setDevelopmentAccount(db, { organizationId: ORG, userId: "u-dev", developmentAccount: true })
    expect(again).toEqual({ success: true, name: "Dee Dev", changed: false })
    const cleared = await setDevelopmentAccount(db, { organizationId: ORG, userId: "u-dev", developmentAccount: false })
    expect(cleared).toEqual({ success: true, name: "Dee Dev", changed: true })
    expect((await developmentAccountUserIds(db, ORG)).size).toBe(0)
  })

  it("refuses someone who is not a member of the company", async () => {
    const result = await setDevelopmentAccount(db, { organizationId: OTHER_ORG, userId: "u-staff", developmentAccount: true })
    expect(result.success).toBe(false)
  })

  it("leaves development accounts out of staff pickers", async () => {
    await tag("u-dev")
    await tag("u-bot")
    expect((await activeStaff(db, ORG)).map((person) => person.id)).toEqual(["u-staff"])

    const options = await loadProjectTaskAssigneeOptions(db, {
      organizationId: ORG,
      projectId: "p1",
      grants: { vendors: false, internal: true },
    })
    const names = options.projectContacts.map((option) => option.name)
    expect(names).toContain("Sam Staff")
    expect(names).not.toContain("Dee Dev")
    expect(names).not.toContain("Build Bot")
  })

  it("leaves development accounts out of the staff count, keeping contacts with no login", async () => {
    const grants = { customers: true, vendors: true, internal: true }
    expect((await loadDirectorySummary(db, ORG, grants)).internalCount).toBe(3)
    await tag("u-dev")
    expect((await loadDirectorySummary(db, ORG, grants)).internalCount).toBe(2)
  })

  it("never offers a development account for Sage employee linking", async () => {
    await tag("u-dev")
    await tag("u-bot")
    const employees = [
      { sageRecordId: GUID(1), sageEmployeeNumber: "1", firstName: "Dee", lastName: "Dev", email: "dev@acme.test", sageStatusCode: 1, inactive: false },
      { sageRecordId: GUID(2), sageEmployeeNumber: "2", firstName: "Build", lastName: "Bot", email: "bot@acme.test", sageStatusCode: 1, inactive: false },
    ]
    await applySageEmployeeDirectory(db, d1, ORG, employees, NOW)
    // Neither the tagged contact nor the tagged login without a contact is linked by email.
    const devContact: unknown = sqlite.prepare("SELECT sage_employee_id FROM internal_contacts WHERE id = 'ic-dev'").get()
    expect(typeof devContact === "object" && devContact !== null ? Reflect.get(devContact, "sage_employee_id") : "missing").toBeNull()
    const botContacts: unknown = sqlite.prepare("SELECT count(*) AS n FROM internal_contacts WHERE user_id = 'u-bot'").get()
    expect(typeof botContacts === "object" && botContacts !== null ? Number(Reflect.get(botContacts, "n")) : -1).toBe(0)

    const overview = await staffSageLinkOverview(db, ORG)
    const targets = overview.needsLinking.map((row) => (row.target.kind === "contact" ? row.target.internalContactId : row.target.user.userId))
    expect(targets).toContain("ic-staff")
    expect(targets).not.toContain("ic-dev")
    expect(targets).not.toContain("u-bot")
  })
})
