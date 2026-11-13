import { describe, expect, it } from "vitest"

import { contractDepositMachine } from "@/lib/domain/financials/deposit-machine"
import { CONTRACT_DEPOSIT_STATUSES } from "@/lib/domain/financials/statuses"
import { availableEvents, machineProblems, nextState } from "@/lib/shared/state-machine"

describe("contract deposit machine", () => {
  it("is well formed over the shared status list", () => {
    expect(machineProblems(contractDepositMachine)).toEqual([])
    expect(contractDepositMachine.states).toEqual(CONTRACT_DEPOSIT_STATUSES)
  })

  it("a voided deposit stays void", () => {
    expect(availableEvents(contractDepositMachine, "void")).toEqual([])
    expect(nextState(contractDepositMachine, "void", "receive").ok).toBe(false)
  })

  it("a request is received, and a received deposit can be saved back as requested or voided", () => {
    expect(nextState(contractDepositMachine, "requested", "receive")).toMatchObject({ ok: true, to: "received" })
    expect(availableEvents(contractDepositMachine, "received")).toEqual(["unreceive", "void"])
  })
})
