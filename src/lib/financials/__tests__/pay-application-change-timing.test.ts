import { describe, expect, it } from "vitest"

import { changeTiming } from "../pay-application-change-orders"

// Draws 1–3 imported from spreadsheets, then Compass application 4.
const applications = [
  { id: "imp-2", applicationNumber: "2", periodTo: "2026-06-30" },
  { id: "imp-1", applicationNumber: "1", periodTo: "2026-05-31" },
  { id: "imp-3", applicationNumber: "3", periodTo: "2026-07-31" },
  { id: "app-4", applicationNumber: "4", periodTo: "2026-08-31" },
]

describe("changeTiming", () => {
  it("counts a record executed after the prior application's period as this month", () => {
    expect(changeTiming("2026-08-05T15:00:00.000Z", applications, "app-4")).toEqual({
      current: true,
      firstBilled: { applicationNumber: "4", periodTo: "2026-08-31", thisPeriod: true },
    })
  })

  it("counts a record executed on or before the prior application's period_to as previous", () => {
    expect(changeTiming("2026-07-31T20:00:00.000Z", applications, "app-4").current).toBe(false)
    expect(changeTiming("2026-03-01T12:00:00.000Z", applications, "app-4").current).toBe(false)
  })

  it("bills an older variance in the first application whose period covers it, imported draws included", () => {
    expect(changeTiming("2026-06-10T12:00:00.000Z", applications, "app-4").firstBilled).toEqual({
      applicationNumber: "2",
      periodTo: "2026-06-30",
      thisPeriod: false,
    })
    expect(changeTiming("2026-01-10T12:00:00.000Z", applications, "app-4").firstBilled?.applicationNumber).toBe("1")
  })

  it("treats everything as this month without a prior application", () => {
    const only = [{ id: "app-1", applicationNumber: "1", periodTo: "2026-08-31" }]
    expect(changeTiming("2026-02-01T12:00:00.000Z", only, "app-1")).toEqual({
      current: true,
      firstBilled: { applicationNumber: "1", periodTo: "2026-08-31", thisPeriod: true },
    })
  })

  it("never names a later application as where a change was billed", () => {
    const later = [...applications, { id: "app-5", applicationNumber: "5", periodTo: "2026-09-30" }]
    expect(changeTiming("2026-09-15T12:00:00.000Z", later, "app-4").firstBilled).toMatchObject({ applicationNumber: "4", thisPeriod: true })
  })
})
