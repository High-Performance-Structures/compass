import { describe, expect, it } from "vitest"

import {
  availableEvents,
  defineMachine,
  machineProblems,
  nextState,
  type StatusStore,
  transition,
} from "../state-machine"

const invitation = defineMachine({
  name: "invitation",
  states: ["sent", "accepted", "revoked", "expired"],
  initial: "sent",
  terminal: ["accepted", "revoked", "expired"],
  transitions: {
    accept: { from: ["sent"], to: "accepted" },
    revoke: { from: ["sent"], to: "revoked" },
    expire: { from: ["sent"], to: "expired" },
  },
})

type InvitationState = (typeof invitation.states)[number]

function memoryStore(rows: Map<string, InvitationState>): StatusStore<InvitationState> {
  return {
    read: async (id) => rows.get(id) ?? null,
    compareAndSet: async (id, from, to) => {
      if (rows.get(id) !== from) return false
      rows.set(id, to)
      return true
    },
  }
}

describe("state machine", () => {
  it("a well-formed machine has no problems", () => {
    expect(machineProblems(invitation)).toEqual([])
  })

  it("reports unreachable states, dead ends, and terminal exits", () => {
    const broken = defineMachine({
      name: "broken",
      states: ["a", "b", "orphan", "stuck"],
      initial: "a",
      terminal: ["b"],
      transitions: {
        go: { from: ["a"], to: "b" },
        back: { from: ["b"], to: "a" },
        stick: { from: ["a"], to: "stuck" },
      },
    })
    expect(machineProblems(broken)).toEqual([
      'terminal state "b" has outgoing events: back',
      'state "orphan" cannot be reached from "a"',
      'state "orphan" is a dead end but not marked terminal',
      'state "stuck" is a dead end but not marked terminal',
    ])
  })

  it("counts entry states as reachable", () => {
    const imported = defineMachine({
      name: "imported",
      states: ["new", "found", "done"],
      initial: "new",
      entry: ["found"],
      terminal: ["done"],
      transitions: { finish: { from: ["new", "found"], to: "done" } },
    })
    expect(machineProblems(imported)).toEqual([])
    expect(machineProblems({ ...imported, entry: [] })).toEqual([
      'state "found" cannot be reached from "new"',
    ])
  })

  it("allows only declared transitions", () => {
    expect(nextState(invitation, "sent", "accept")).toEqual({ ok: true, from: "sent", to: "accepted" })
    expect(nextState(invitation, "revoked", "accept")).toMatchObject({ ok: false, reason: "invalid_transition" })
    expect(availableEvents(invitation, "sent")).toEqual(["accept", "revoke", "expire"])
    expect(availableEvents(invitation, "accepted")).toEqual([])
  })

  it("transitions through the store with compare-and-set", async () => {
    const rows = new Map<string, InvitationState>([["inv-1", "sent"]])
    expect(await transition(invitation, memoryStore(rows), "inv-1", "accept")).toEqual({
      ok: true,
      from: "sent",
      to: "accepted",
    })
    expect(rows.get("inv-1")).toBe("accepted")
    expect(await transition(invitation, memoryStore(rows), "inv-1", "revoke")).toMatchObject({
      ok: false,
      reason: "invalid_transition",
    })
    expect(await transition(invitation, memoryStore(rows), "missing", "accept")).toMatchObject({
      ok: false,
      reason: "not_found",
    })
  })

  it("rejects through the guard without writing", async () => {
    const rows = new Map<string, InvitationState>([["inv-1", "sent"]])
    const result = await transition(invitation, memoryStore(rows), "inv-1", "accept", () => "invite email does not match")
    expect(result).toEqual({ ok: false, reason: "guard_rejected", message: "invite email does not match" })
    expect(rows.get("inv-1")).toBe("sent")
  })

  it("reports a conflict when the row changed after it was read", async () => {
    const rows = new Map<string, InvitationState>([["inv-1", "sent"]])
    const racing: StatusStore<InvitationState> = {
      read: async () => "sent",
      compareAndSet: async () => {
        rows.set("inv-1", "revoked")
        return false
      },
    }
    expect(await transition(invitation, racing, "inv-1", "accept")).toMatchObject({ ok: false, reason: "conflict" })
  })
})
