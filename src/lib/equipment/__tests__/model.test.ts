import { describe, expect, it } from "vitest"

import {
  emptyMachineLogDraft,
  machineTimeChargeCents,
  serviceDue,
  serviceDueLabel,
  validateMachineLog,
  type MachineLogDraft,
} from "@/lib/equipment/model"

function draft(overrides: Partial<MachineLogDraft>): MachineLogDraft {
  return { ...emptyMachineLogDraft("hours", "2026-10-13"), machineId: "m1", ...overrides }
}

describe("validateMachineLog", () => {
  it("needs a job and some hours for machine time", () => {
    const result = validateMachineLog(draft({}))
    expect(result.errors.map((error) => error.key)).toEqual(["projectId", "hours"])
  })

  it("cleans an hours entry to the quarter hour and drops cost fields", () => {
    const result = validateMachineLog(draft({ projectId: "p1", runningHours: "6.1", standbyHours: "1", amount: "50", vendor: "X" }))
    expect(result.errors).toEqual([])
    expect(result.values).toMatchObject({ runningHours: 6, standbyHours: 1, idleHours: null, amountCents: null, vendor: null })
  })

  it("needs a cost for fuel and keeps gallons", () => {
    expect(validateMachineLog(draft({ kind: "fuel" })).errors.map((error) => error.key)).toEqual(["amount"])
    const result = validateMachineLog(draft({ kind: "fuel", gallons: "18.4", amount: "$72.50", paidWith: "Fuel card" }))
    expect(result.values).toMatchObject({ gallons: 18.4, amountCents: 7250, paidWith: "Fuel card", runningHours: null })
  })

  it("accepts a scheduled service with only shop hours", () => {
    const result = validateMachineLog(draft({ kind: "maintenance", serviceItemId: "s1", shopHours: "2" }))
    expect(result.errors).toEqual([])
    expect(result.values).toMatchObject({ serviceItemId: "s1", shopHours: 2, amountCents: null })
  })

  it("asks what a repair or other cost was", () => {
    expect(validateMachineLog(draft({ kind: "repair", amount: "400" })).errors.map((error) => error.key)).toEqual(["notes"])
    expect(validateMachineLog(draft({ kind: "other", amount: "40" })).errors.map((error) => error.key)).toEqual(["notes"])
  })

  it("rejects bad numbers with the field's own message", () => {
    const result = validateMachineLog(draft({ projectId: "p1", runningHours: "30" }))
    expect(result.errors).toEqual([{ key: "runningHours", message: "Running hours can't be more than 24." }])
  })
})

describe("machineTimeChargeCents", () => {
  it("prices each kind of hour at its rate", () => {
    expect(machineTimeChargeCents({ runningHours: 6, standbyHours: 1, idleHours: null }, { runningRateCents: 13_500, standbyRateCents: 5_000, idleRateCents: null })).toBe(86_000)
  })

  it("is null when nothing can be priced", () => {
    expect(machineTimeChargeCents({ runningHours: 6, standbyHours: null, idleHours: null }, { runningRateCents: null, standbyRateCents: null, idleRateCents: null })).toBeNull()
  })
})

describe("serviceDue", () => {
  const item = { everyHours: 250, everyDays: 180, lastDoneHours: 1_000, lastDoneOn: "2026-06-01" }

  it("counts down hours and days, whichever comes first", () => {
    expect(serviceDue(item, 1_246.5, "2026-10-13")).toEqual({ hoursLeft: 3.5, daysLeft: 46, state: "soon" })
    expect(serviceDue(item, 1_100, "2026-12-01").state).toBe("due")
    expect(serviceDue(item, 1_100, "2026-10-13").state).toBe("ok")
  })

  it("labels what is due", () => {
    expect(serviceDueLabel("Oil change", serviceDue({ ...item, everyDays: null }, 1_246.5, "2026-10-13"))).toBe("Oil change in 3.5 h")
    expect(serviceDueLabel("Grease", serviceDue({ everyHours: null, everyDays: 30, lastDoneHours: null, lastDoneOn: "2026-09-01" }, null, "2026-10-13"))).toBe("Grease overdue by 12 days")
  })
})
