import { afterEach, describe, expect, it, vi } from "vitest"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { projectContactActiveCondition } from "@/lib/domain/contacts/resolved-project-contacts"
import { invitationOpenCondition } from "@/lib/domain/identity/store"
import { insertProjectMembersIfAbsent, removeProjectMemberGrant, upsertProjectMemberRole } from "@/lib/domain/project/store"
import { insertRow } from "@/test/migrated-database"

// Lets a test revoke the invitation in the gap between the grant and the accept.
const beforeAccept = vi.hoisted((): { run: (() => void) | null } => ({ run: null }))
vi.mock("@/lib/domain/identity/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/identity/store")>()
  return {
    ...actual,
    markProjectAccessInvitationAccepted: async (...args: Parameters<typeof actual.markProjectAccessInvitationAccepted>) => {
      beforeAccept.run?.()
      return actual.markProjectAccessInvitationAccepted(...args)
    },
  }
})

const { claimProjectAccessInvitations } = await import("@/lib/domain/identity/accounts")

// Production's schema (every migration), so the unique (project_id, user_id)
// index, foreign keys and NOT NULL rules all apply as they do on D1.
function seed(sqlite: ReturnType<typeof migratedDb>["sqlite"]): void {
  insertRow(sqlite, "organizations", { id: "org", type: "internal" })
  insertRow(sqlite, "users", { id: "staff" })
  insertRow(sqlite, "users", { id: "u1" })
  insertRow(sqlite, "users", { id: "u2" })
  insertRow(sqlite, "projects", { id: "p1", organization_id: "org" })
  insertRow(sqlite, "project_contacts", { id: "c1", project_id: "p1", contact_type: "owner", active: 1 })
  insertRow(sqlite, "project_access_invitations", {
    id: "i1", organization_id: "org", project_id: "p1", project_contact_id: "c1", email: "guest@example.test",
    role: "guest", invited_by: "staff", invited_at: "t0", created_at: "t0", updated_at: "t0",
  })
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
  beforeAccept.run = null
})

const member = { projectId: "p1", userId: "u1", role: "guest", now: "t1" }
const pending = {
  id: "i1",
  organizationId: "org",
  projectId: "p1",
  projectContactId: "c1",
  role: "guest",
  invitedBy: "staff",
  workosExpiresAt: null,
}
const account = { id: "u1", phone: "555", address: "Main St" }

function members(sqlite: ReturnType<typeof migratedDb>["sqlite"]): unknown[] {
  return sqlite.prepare("SELECT id, user_id, role FROM project_members ORDER BY user_id").all()
}

describe("upsertProjectMemberRole", () => {
  it("adds a membership, then only changes the role of the same row", async () => {
    const { sqlite, db } = open()
    const first = await upsertProjectMemberRole(db, member)
    expect(first.written).toBe(true)
    expect(first.createdId).not.toBeNull()
    const second = await upsertProjectMemberRole(db, { ...member, role: "client" })
    expect(second).toEqual({ written: true, createdId: null })
    expect(members(sqlite)).toEqual([{ id: first.createdId, user_id: "u1", role: "client" }])
  })

  it("writes nothing once the invitation is revoked or the contact is off the job", async () => {
    const { sqlite, db } = open()
    sqlite.exec("UPDATE project_access_invitations SET status = 'revoked'")
    expect(await upsertProjectMemberRole(db, member, { onlyIf: invitationOpenCondition("i1") })).toEqual({ written: false, createdId: null })
    sqlite.exec("UPDATE project_access_invitations SET status = 'sent'; UPDATE project_contacts SET active = 0")
    expect((await upsertProjectMemberRole(db, member, { onlyIf: projectContactActiveCondition("c1") })).written).toBe(false)
    expect(members(sqlite)).toEqual([])
  })

  it("leaves an existing membership's role alone when the condition fails", async () => {
    const { sqlite, db } = open()
    sqlite.exec("INSERT INTO project_members VALUES ('m0', 'p1', 'u1', 'client', 't0'); UPDATE project_contacts SET active = 0")
    expect((await upsertProjectMemberRole(db, { ...member, role: "guest" }, { onlyIf: projectContactActiveCondition("c1") })).written).toBe(false)
    expect(members(sqlite)).toEqual([{ id: "m0", user_id: "u1", role: "client" }])
  })

  it("removes only the row a grant created", async () => {
    const { sqlite, db } = open()
    sqlite.exec("INSERT INTO project_members VALUES ('m0', 'p1', 'u1', 'client', 't0')")
    await removeProjectMemberGrant(db, "not-this-one")
    expect(members(sqlite)).toHaveLength(1)
  })
})

describe("insertProjectMembersIfAbsent", () => {
  it("skips people already on the job instead of failing", async () => {
    const { sqlite, db } = open()
    sqlite.exec("INSERT INTO project_members VALUES ('m0', 'p1', 'u1', 'client', 't0')")
    const added = await insertProjectMembersIfAbsent(db, [
      { id: "m1", projectId: "p1", userId: "u1", role: "office", assignedAt: "t1" },
      { id: "m2", projectId: "p1", userId: "u2", role: "office", assignedAt: "t1" },
    ])
    expect(added).toBe(1)
    expect(members(sqlite)).toEqual([
      { id: "m0", user_id: "u1", role: "client" },
      { id: "m2", user_id: "u2", role: "office" },
    ])
  })
})

describe("claiming an invitation at sign-in", () => {
  it("grants the job and accepts an open invitation", async () => {
    const { sqlite, db } = open()
    await claimProjectAccessInvitations(db, account, [pending], "t1")
    expect(members(sqlite)).toEqual([expect.objectContaining({ user_id: "u1", role: "guest" })])
    expect(sqlite.prepare("SELECT status FROM project_access_invitations").get()).toEqual({ status: "accepted" })
  })

  it("grants nothing when staff took the contact off the job (removed or archived)", async () => {
    const { sqlite, db } = open()
    sqlite.exec("UPDATE project_contacts SET active = 0")
    expect(await claimProjectAccessInvitations(db, account, [pending], "t1")).toBeNull()
    expect(members(sqlite)).toEqual([])
    expect(sqlite.prepare("SELECT count(*) AS n FROM organization_members").get()).toEqual({ n: 0 })
  })

  it("withdraws the new membership when the invitation is revoked mid-claim", async () => {
    const { sqlite, db } = open()
    beforeAccept.run = () => sqlite.exec("UPDATE project_access_invitations SET status = 'revoked'")
    expect(await claimProjectAccessInvitations(db, account, [pending], "t1")).toBeNull()
    expect(members(sqlite)).toEqual([])
    expect(sqlite.prepare("SELECT status FROM project_access_invitations").get()).toEqual({ status: "revoked" })
  })

  it("keeps a membership that existed before a claim that lost to a revoke", async () => {
    const { sqlite, db } = open()
    sqlite.exec("INSERT INTO project_members VALUES ('m0', 'p1', 'u1', 'guest', 't0')")
    beforeAccept.run = () => sqlite.exec("UPDATE project_access_invitations SET status = 'revoked'")
    await claimProjectAccessInvitations(db, account, [pending], "t1")
    expect(members(sqlite)).toEqual([{ id: "m0", user_id: "u1", role: "guest" }])
  })
})
