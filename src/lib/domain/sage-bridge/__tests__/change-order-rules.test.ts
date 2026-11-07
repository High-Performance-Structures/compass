import { describe, expect, it } from "vitest"

import {
  planSageChangeOrder,
  sageAmount,
  sageChangeOrderNumberError,
  sageChangeOrderState,
  sageDescription,
  type SageChangeOrderSource,
} from "@/lib/domain/sage-bridge/change-order-rules"
import { DEFAULT_SAGE_CHANGE_ORDER_SETTINGS } from "@/lib/feature-settings/sage-change-order-settings"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { sageChangeOrderWritePayload } from "@/lib/sage/change-order-write"

const RECORDS: Record<string, string> = { "01 31 00": "1310000", "06 10 00": "6100000", "Company Overhead": "34" }

function mapCostCode(costCode: string): SageCostCodeMapping {
  const record = RECORDS[costCode]
  return record
    ? { status: "mapped", by: "csi_prefix", sageName: `${costCode} - Example`, sageRecordNumber: record }
    : { status: "unmapped", reason: `No Sage cost code name starts with "${costCode}".` }
}

const VARIANCE: SageChangeOrderSource = {
  id: "co-1",
  recordType: "variance",
  number: "006",
  title: "September Variances",
  status: "executed",
  executedAt: "2026-10-01T12:00:00.000Z",
  acceptedOn: null,
  sageRecordId: null,
  lines: [
    { costCode: "06 10 00", description: "Framing overage", amountCents: 10_000 },
    { costCode: "06 10 00", description: "More framing", amountCents: 2_550 },
    { costCode: "99 10 00", description: "Overhead", amountCents: 1_000 },
    { costCode: null, description: "Note only", amountCents: null },
  ],
}

const INPUT = { settings: DEFAULT_SAGE_CHANGE_ORDER_SETTINGS, projectNumber: "X-1-2", sageJobNumber: "1200", mapCostCode }

describe("planning a change order for Sage", () => {
  it("names a variance V-, keeps one line per cost code and codes every line cost type 5", () => {
    const plan = planSageChangeOrder(VARIANCE, INPUT)
    expect(plan.blockers).toEqual([])
    expect(plan.sageName).toBe("V-006")
    expect(plan.suggestedNumber).toBe("V-006")
    expect(plan.description).toBe("V-006 September Variances")
    expect(plan.date).toBe("2026-10-01")
    expect(plan.statusNumber).toBe(1)
    expect(plan.lines.map((line) => [line.costCode, line.sageCostCodeRecord, line.costTypeNumber, line.amountCents])).toEqual([
      ["06 10 00", "6100000", 5, 12_550],
      ["Company Overhead", "34", 5, 1_000],
    ])
    expect(plan.totalCents).toBe(13_550)
  })

  it("uses the company's number format and the plain title for a change order", () => {
    const plan = planSageChangeOrder(
      { ...VARIANCE, recordType: "change_order", number: "14", title: "Add covered deck" },
      { ...INPUT, settings: { ...DEFAULT_SAGE_CHANGE_ORDER_SETTINGS, numberFormat: "CO-{n}" } }
    )
    expect(plan.suggestedNumber).toBe("CO-14")
    expect(plan.description).toBe("Add covered deck")
  })

  it("blocks a change order that isn't executed, isn't linked, or has an unmapped or uncoded line", () => {
    const plan = planSageChangeOrder(
      {
        ...VARIANCE,
        status: "pricing",
        executedAt: null,
        lines: [
          { costCode: "02 00 00", description: "Unknown", amountCents: 500 },
          { costCode: null, description: "No code", amountCents: 100 },
        ],
      },
      { ...INPUT, sageJobNumber: null }
    )
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "The variance isn't approved yet.",
        "The project isn't linked to a Sage job.",
        "The change order has no executed date.",
        "A line with an amount has no cost code.",
        expect.stringContaining("02 00 00"),
      ])
    )
  })

  it("prefers the owner's acceptance date", () => {
    expect(planSageChangeOrder({ ...VARIANCE, acceptedOn: "2026-09-30" }, INPUT).date).toBe("2026-09-30")
  })
})

describe("Sage limits", () => {
  it("cuts descriptions to 50 characters without splitting a character", () => {
    const long = `${"a".repeat(49)}é and more`
    expect(sageDescription(long)).toBe(`${"a".repeat(49)}é`)
    expect(sageDescription("  two   spaces  ")).toBe("two spaces")
  })

  it("checks the number's length and uniqueness on the job", () => {
    expect(sageChangeOrderNumberError("", { sageNumbers: [], compassNumbers: [] })).toBe("Enter the Sage change order number.")
    expect(sageChangeOrderNumberError("x".repeat(21), { sageNumbers: [], compassNumbers: [] })).toContain("20 characters")
    expect(sageChangeOrderNumberError("v-006", { sageNumbers: ["V-006"], compassNumbers: [] })).toContain("Sage already has")
    expect(sageChangeOrderNumberError("14", { sageNumbers: [], compassNumbers: ["14"] })).toContain("already being sent")
    expect(sageChangeOrderNumberError("15", { sageNumbers: ["14"], compassNumbers: [] })).toBeNull()
  })

  it("writes Sage amounts as exact decimals", () => {
    expect(sageAmount(13_550)).toBe("135.50")
    expect(sageAmount(-5)).toBe("-0.05")
  })
})

describe("whether Sage already has it", () => {
  const rows = [
    { sageRecordId: "48", changeOrderNumber: "3267", description: "September Variances", approvedAmountCents: 33_129 },
    { sageRecordId: "49", changeOrderNumber: "V-006", description: "Other", approvedAmountCents: 13_550 },
  ]

  it("is unknown until Compass has read the job", () => {
    expect(sageChangeOrderState({ sageRecordId: null, numbers: ["V-006"], descriptions: [], amountCents: 1 }, null)).toEqual({ state: "unknown" })
  })

  it("matches by stored record, then number, then description", () => {
    expect(sageChangeOrderState({ sageRecordId: "48", numbers: [], descriptions: [], amountCents: 33_129 }, rows)).toMatchObject({ state: "in_sage", sageRecordId: "48" })
    expect(sageChangeOrderState({ sageRecordId: null, numbers: ["v-006"], descriptions: [], amountCents: 13_550 }, rows)).toMatchObject({ state: "in_sage", sageNumber: "V-006" })
    expect(sageChangeOrderState({ sageRecordId: null, numbers: ["1"], descriptions: ["september  variances"], amountCents: 100 }, rows)).toMatchObject({ state: "differs", sageAmountCents: 33_129 })
    expect(sageChangeOrderState({ sageRecordId: null, numbers: ["99"], descriptions: ["Nope"], amountCents: 100 }, rows)).toEqual({ state: "not_in_sage" })
  })
})

describe("the writer payload", () => {
  it("carries the confirmed number, the job and every line", () => {
    const plan = planSageChangeOrder(VARIANCE, INPUT)
    const payload = sageChangeOrderWritePayload(plan, { projectId: "p1", number: " V-006 ", sageJobNumber: "1200", sageJobId: null })
    expect(payload).toMatchObject({
      operationType: "add_prime_change_order",
      job: { sageJobNumber: "1200" },
      changeOrder: { number: "V-006", date: "2026-10-01", approvedDate: "2026-10-01", statusNumber: 1, totalApprovedAmount: "135.50" },
      lines: [
        { costCodeRecordNumber: "6100000", costTypeNumber: 5, approvedAmount: "125.50" },
        { costCodeRecordNumber: "34", costTypeNumber: 5, approvedAmount: "10.00" },
      ],
    })
  })

  it("refuses a plan with a blocker or a number Sage can't take", () => {
    const blocked = planSageChangeOrder({ ...VARIANCE, status: "draft" }, INPUT)
    expect(sageChangeOrderWritePayload(blocked, { projectId: "p1", number: "V-006", sageJobNumber: "1200", sageJobId: null })).toBeNull()
    const plan = planSageChangeOrder(VARIANCE, INPUT)
    expect(sageChangeOrderWritePayload(plan, { projectId: "p1", number: "x".repeat(21), sageJobNumber: "1200", sageJobId: null })).toBeNull()
  })
})
