import { afterEach, describe, expect, it } from "vitest"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { insertRow } from "@/test/migrated-database"

import { ensureExternalOrganizationMembership, finishInvitationEmail } from "../store"

// Production's schema (every migration), with the parents its keys need.
function seed(sqlite: ReturnType<typeof migratedDb>["sqlite"]): void {
  insertRow(sqlite, "organizations", { id: "org", type: "internal" })
  insertRow(sqlite, "users", { id: "u" })
  insertRow(sqlite, "users", { id: "staff" })
  insertRow(sqlite, "projects", { id: "p", organization_id: "org" })
}

let current: ReturnType<typeof migratedDb> | null = null
function open(): ReturnType<typeof migratedDb> {
  current = migratedDb()
  seed(current.sqlite)
  return current
}
afterEach(() => {
  current?.sqlite.close()
  current = null
})

describe("ensureExternalOrganizationMembership", () => {
  it("adds an invited owner to the organization as a client", async () => {
    const { sqlite, db } = open()
    await ensureExternalOrganizationMembership(db, { organizationId: "org", userId: "u", role: "owner", now: "t1" })
    expect(sqlite.prepare("SELECT organization_id, user_id, role, joined_at FROM organization_members").all()).toEqual([
      { organization_id: "org", user_id: "u", role: "client", joined_at: "t1" },
    ])
  })

  it("moves an existing membership to the external role without a second row", async () => {
    const { sqlite, db } = open()
    sqlite.exec("INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('m1', 'org', 'u', 'client', 't0')")
    await ensureExternalOrganizationMembership(db, { organizationId: "org", userId: "u", role: "supplier", now: "t1" })
    expect(sqlite.prepare("SELECT id, role, joined_at FROM organization_members").all()).toEqual([
      { id: "m1", role: "supplier", joined_at: "t0" },
    ])
  })
})

describe("finishInvitationEmail", () => {
  it("records the outcome and releases the claim only for the matching token", async () => {
    const { sqlite, db } = open()
    sqlite.exec(`INSERT INTO project_access_invitations (id, organization_id, project_id, email, role, email_status,
      email_claim_token, email_claimed_at, email_provider, invited_by, invited_at, created_at, updated_at)
      VALUES ('i1', 'org', 'p', 'a@example.test', 'owner', 'sending', 'token', 't0', 'previous', 'staff', 't0', 't0', 't0')`)

    await finishInvitationEmail(db, { invitationId: "i1", token: "other", emailStatus: "sent", emailNextAttemptAt: null, emailError: null, updatedAt: "t1" })
    expect(sqlite.prepare("SELECT email_status FROM project_access_invitations").get()).toEqual({ email_status: "sending" })

    // Fields left out (here the provider) keep their stored value.
    await finishInvitationEmail(db, { invitationId: "i1", token: "token", emailStatus: "retrying", emailNextAttemptAt: "t2", emailError: "busy", updatedAt: "t1" })
    expect(sqlite.prepare(`SELECT email_status, email_next_attempt_at, email_error, email_provider, email_claim_token,
      email_claimed_at, updated_at FROM project_access_invitations`).get()).toEqual({
      email_status: "retrying",
      email_next_attempt_at: "t2",
      email_error: "busy",
      email_provider: "previous",
      email_claim_token: null,
      email_claimed_at: null,
      updated_at: "t1",
    })
  })
})
