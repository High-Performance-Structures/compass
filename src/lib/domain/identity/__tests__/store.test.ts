import { afterEach, describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

import { ensureExternalOrganizationMembership, finishInvitationEmail } from "../store"

const SCHEMA = `
  CREATE TABLE organization_members (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, joined_at TEXT NOT NULL, UNIQUE (organization_id, user_id));
  CREATE TABLE project_access_invitations (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
    project_contact_id TEXT, email TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent',
    workos_invitation_id TEXT, workos_expires_at TEXT, email_provider TEXT, email_provider_message_id TEXT,
    email_error TEXT, email_status TEXT NOT NULL DEFAULT 'unknown', email_subject TEXT, email_message TEXT,
    email_attempts INTEGER NOT NULL DEFAULT 0, email_next_attempt_at TEXT, email_claim_token TEXT,
    email_claimed_at TEXT, email_sent_at TEXT, invited_by TEXT NOT NULL, invited_at TEXT NOT NULL,
    accepted_by TEXT, accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`

let current: ReturnType<typeof sqliteDb> | null = null
function open(): ReturnType<typeof sqliteDb> {
  current = sqliteDb(SCHEMA)
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
    sqlite.exec("INSERT INTO organization_members VALUES ('m1', 'org', 'u', 'client', 't0')")
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
