import { describe, expect, it } from "vitest"

import { accessRequestMachine } from "@/lib/domain/access-requests/machine"
import { availableEvents, machineProblems, nextState } from "@/lib/shared/state-machine"

describe("access request machine", () => {
  it("is well formed", () => {
    expect(machineProblems(accessRequestMachine)).toEqual([])
  })

  it("only a pending request can be approved, declined or withdrawn", () => {
    expect(availableEvents(accessRequestMachine, "pending")).toEqual(["approve", "decline", "withdraw"])
    for (const from of ["approved", "declined", "withdrawn"] as const) {
      expect(nextState(accessRequestMachine, from, "approve").ok).toBe(false)
      expect(nextState(accessRequestMachine, from, "decline").ok).toBe(false)
      expect(nextState(accessRequestMachine, from, "withdraw").ok).toBe(false)
    }
  })

  it("declined and withdrawn are final; only an approval whose grant failed reopens", () => {
    expect(availableEvents(accessRequestMachine, "approved")).toEqual(["reopen"])
    expect(availableEvents(accessRequestMachine, "declined")).toEqual([])
    expect(availableEvents(accessRequestMachine, "withdrawn")).toEqual([])
  })
})

describe("access request status writes", () => {
  it("all go through the machine in access-requests/store.ts", async () => {
    const { readFileSync } = await import("node:fs")
    const store = readFileSync("src/lib/domain/access-requests/store.ts", "utf8")
    // Each function that updates organization_access_requests and sets status
    // must take it from accessRequestMachine and compare-and-set on the
    // event's source states.
    const writers = store.split("\nexport ").filter((fn) => fn.includes(".update(organizationAccessRequests)"))
    const statusWriters = writers.filter((fn) => /[{,\s]status:/.test(fn))
    expect(statusWriters.length).toBe(3)
    for (const fn of statusWriters) {
      expect(fn).toMatch(/status: accessRequestMachine\.transitions(\.\w+|\[\w+\])\.to/)
      expect(fn).toMatch(/statusIn\(("\w+"|event)\)/)
    }
    expect(writers.length - statusWriters.length).toBe(2)
    // New rows start at the machine's initial state.
    expect(store).toMatch(/status: accessRequestMachine\.initial/)
    // Nothing else in the app writes the table.
    expect(store).not.toMatch(/status: "(pending|approved|declined|withdrawn)"/)
  })
})
