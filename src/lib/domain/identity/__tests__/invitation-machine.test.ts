import { describe, expect, it } from "vitest"

import { invitationMachine } from "@/lib/domain/identity/invitation-machine"
import { availableEvents, machineProblems, nextState } from "@/lib/shared/state-machine"

describe("project access invitation machine", () => {
  it("is well formed", () => {
    expect(machineProblems(invitationMachine)).toEqual([])
  })

  it("only a sent invitation can be accepted or expire", () => {
    expect(nextState(invitationMachine, "sent", "accept").ok).toBe(true)
    expect(nextState(invitationMachine, "revoked", "accept").ok).toBe(false)
    expect(nextState(invitationMachine, "expired", "accept").ok).toBe(false)
    expect(nextState(invitationMachine, "accepted", "expire").ok).toBe(false)
  })

  it("revoking ends sent and accepted invitations", () => {
    expect(availableEvents(invitationMachine, "accepted")).toEqual(["revoke"])
    expect(availableEvents(invitationMachine, "revoked")).toEqual([])
    expect(availableEvents(invitationMachine, "expired")).toEqual([])
  })
})

describe("invitation status writes", () => {
  it("all go through the machine in identity/store.ts", async () => {
    const { readFileSync } = await import("node:fs")
    const store = readFileSync("src/lib/domain/identity/store.ts", "utf8")
    // Each update of project_access_invitations that sets status must take it
    // from invitationMachine (or the REVOKE_IF_PENDING / invitationStatusAfter helpers built on it).
    const updates = store.split(".update(projectAccessInvitations)").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("\n}\n")))
    const statusWrites = updates.filter((update) => /[{,\s]status:/.test(update))
    expect(statusWrites.length).toBeGreaterThan(0)
    for (const update of statusWrites) {
      expect(update).toMatch(/status: (invitationMachine\.transitions\.\w+\.to|invitationStatusAfter\(|REVOKE_IF_PENDING)/)
    }
    expect(store).toMatch(/REVOKE_IF_PENDING = sql`[^`]*invitationMachine\.transitions\.revoke\.to/)
  })
})
