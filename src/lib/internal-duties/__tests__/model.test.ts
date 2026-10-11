import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { dutiesFor, monthSummary, parseHours, uncategorizedLogs } from "@/lib/internal-duties/model"

describe("internal duties", () => {
  it("lists the office duties from the default Sage codes", () => {
    const office = dutiesFor(FEATURE_SETTINGS["internal-duties"].defaults, "office")
    expect(office.map((duty) => duty.code)).toContain("502")
    expect(office.find((duty) => duty.code === "502")?.label).toBe("Bank Reconciliations")
    expect(dutiesFor(FEATURE_SETTINGS["internal-duties"].defaults, "field").map((duty) => duty.code)).toContain("1540007")
  })

  it("rounds hours to the quarter hour and allows blank", () => {
    expect(parseHours("2.6")).toEqual({ ok: true, hours: 2.5 })
    expect(parseHours("")).toEqual({ ok: true, hours: null })
    expect(parseHours("0").ok).toBe(false)
    expect(parseHours("30").ok).toBe(false)
  })

  it("totals a month's hours by duty", () => {
    const summary = monthSummary(
      [
        { entryDate: "2026-10-02", dutyCode: "502", dutyLabel: "Bank Reconciliations", hours: 7.75 },
        { entryDate: "2026-10-05", dutyCode: "502", dutyLabel: "Bank Reconciliations", hours: 4 },
        { entryDate: "2026-10-07", dutyCode: "512", dutyLabel: "Accounts Payable", hours: 3 },
        { entryDate: "2026-09-28", dutyCode: "502", dutyLabel: "Bank Reconciliations", hours: 3.5 },
      ],
      "2026-10",
    )
    expect(summary).toEqual([
      { code: "502", label: "Bank Reconciliations", hours: 11.75, entries: 2 },
      { code: "512", label: "Accounts Payable", hours: 3, entries: 1 },
    ])
  })

  it("finds daily logs still waiting for a duty", () => {
    expect(uncategorizedLogs([{ id: "a" }, { id: "b" }], new Set(["a"]))).toEqual([{ id: "b" }])
  })
})
