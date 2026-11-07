import { describe, expect, it } from "vitest"

import {
  mapSageLinesToCompass,
  reconcilePayRequestWithSage,
  sameApplicationNumber,
  shopTicketsCoveredBySage,
  type SageSnapshotLine,
} from "@/lib/domain/budget/sage-pay-request-rules"
import { DEFAULT_SAGE_EXPORT_SETTINGS } from "@/lib/feature-settings/contract-settings"
import { parseFeatureSettings } from "@/lib/feature-settings/registry"
import { varianceSplitter } from "@/lib/financials/pay-application-change-orders"
import { indexSageCatalog, type SageCatalogEntry } from "@/lib/financials/sage-export-codes"

// Invented catalog and billing; no real company, job or amounts.
const CATALOG: readonly SageCatalogEntry[] = [
  { code: "06 10 00", sourceCostCode: "6100", description: "Rough Carpentry", sageMapped: true },
  { code: "Company Overhead", sourceCostCode: "Company Overhead", description: "Company Overhead", sageMapped: true },
]
const INDEX = indexSageCatalog(CATALOG)

function sageLine(sourceLineId: string, costCode: string, description: string, overrides: Partial<SageSnapshotLine> = {}): SageSnapshotLine {
  return {
    sourceLineId,
    costCode,
    csiDivision: "00",
    csiDivisionName: "Division 00",
    description,
    originalEstimate: 1000,
    totalChanges: 0,
    adjustedEstimate: 1000,
    previousWorkCompleted: 200,
    currentWorkCompleted: 100,
    storedMaterials: 0,
    totalCompletedStoredToDate: 300,
    retainageHeld: 0,
    balanceToFinish: 700,
    sortOrder: 0,
    ...overrides,
  }
}

describe("mapSageLinesToCompass", () => {
  const compassCodes = [{ costCode: "03 30 00", divisionCode: "03", divisionName: "Concrete", description: "Cast-in-Place Concrete" }]

  it("uses the project's own cost code, the catalog's record number, a fee name, or flags the line", () => {
    const lines = mapSageLinesToCompass(
      [
        sageLine("a", "3300", "03 30 00 - Cast-in-Place Concrete", { sortOrder: 0 }),
        sageLine("b", "6100", "Framing", { sortOrder: 1 }),
        sageLine("c", "33", "Company Overhead", { sortOrder: 2 }),
        sageLine("d", "999", "Something Sage-only", { sortOrder: 3 }),
      ],
      { index: INDEX, compassCodes }
    )
    expect(lines.map((line) => [line.compassCostCode, line.divisionCode, line.mapped])).toEqual([
      ["03 30 00", "03", true],
      ["06 10 00", "06", true],
      ["Company Overhead", "00", true],
      ["Something Sage-only", "00", false],
    ])
    expect(lines[0]?.compassDescription).toBe("Cast-in-Place Concrete")
  })
})

describe("sameApplicationNumber", () => {
  it("matches Compass and Sage numbers by their sequence", () => {
    expect(sameApplicationNumber("PAYAPP-003", "3")).toBe(true)
    expect(sameApplicationNumber("3", "3")).toBe(true)
    expect(sameApplicationNumber("PAYAPP-004", "3")).toBe(false)
    expect(sameApplicationNumber("Draft", "Draft")).toBe(false)
  })
})

describe("reconcilePayRequestWithSage", () => {
  it("shows every difference by cost code, this period and to date", () => {
    const sage = mapSageLinesToCompass(
      [sageLine("a", "6100", "Rough Carpentry", { currentWorkCompleted: 150, totalCompletedStoredToDate: 350, balanceToFinish: 650 })],
      { index: INDEX, compassCodes: [] }
    )
    const result = reconcilePayRequestWithSage(
      [
        { costCode: "06 10 00", description: "Rough Carpentry", adjustedEstimate: 1000, previousWorkCompleted: 200, currentWorkCompleted: 100, storedMaterials: 0 },
        { costCode: "09 91 00", description: "Painting", adjustedEstimate: 500, previousWorkCompleted: 0, currentWorkCompleted: 0, storedMaterials: 0 },
      ],
      sage
    )
    const framing = result.rows.find((row) => row.key === "06 10 00")
    expect(framing).toMatchObject({ presence: "both", compassThisPeriodCents: 10_000, sageThisPeriodCents: 15_000, mismatch: true })
    expect(result.rows.find((row) => row.key === "09 91 00")).toMatchObject({ presence: "compass_only", mismatch: true })
    expect(result.mismatchCount).toBe(2)
    expect(result.totals.mismatch).toBe(true)
  })

  it("matches when Compass and Sage agree", () => {
    const sage = mapSageLinesToCompass([sageLine("a", "6100", "Rough Carpentry")], { index: INDEX, compassCodes: [] })
    const result = reconcilePayRequestWithSage(
      [{ costCode: "06 10 00", description: "Rough Carpentry", adjustedEstimate: 1000, previousWorkCompleted: 200, currentWorkCompleted: 100, storedMaterials: 0 }],
      sage
    )
    expect(result.mismatchCount).toBe(0)
    expect(result.totals.mismatch).toBe(false)
  })
})

describe("shopTicketsCoveredBySage", () => {
  const lines = mapSageLinesToCompass([sageLine("a", "6100", "Rough Carpentry", { currentWorkCompleted: 100, storedMaterials: 20 })], {
    index: INDEX,
    compassCodes: [],
  })

  it("marks tickets the current period plainly covers", () => {
    const covered = shopTicketsCoveredBySage(
      [
        { id: "t1", ticketDate: "2026-01-10", lines: [{ costCode: "06 10 00", amountCents: 5_000 }] },
        { id: "t2", ticketDate: "2026-01-12", lines: [{ costCode: "06 10 00", amountCents: 7_000 }] },
      ],
      lines,
      "2026-01-31"
    )
    expect([...covered].sort()).toEqual(["t1", "t2"])
  })

  it("leaves ambiguous, uncovered or later tickets for staff", () => {
    expect(
      shopTicketsCoveredBySage(
        [
          { id: "t1", ticketDate: "2026-01-10", lines: [{ costCode: "06 10 00", amountCents: 8_000 }] },
          { id: "t2", ticketDate: "2026-01-12", lines: [{ costCode: "06 10 00", amountCents: 8_000 }] },
        ],
        lines,
        "2026-01-31"
      ).size
    ).toBe(0)
    expect(shopTicketsCoveredBySage([{ id: "t3", ticketDate: "2026-01-10", lines: [{ costCode: "09 91 00", amountCents: 100 }] }], lines, null).size).toBe(0)
    expect(shopTicketsCoveredBySage([{ id: "t4", ticketDate: "2026-02-02", lines: [{ costCode: "06 10 00", amountCents: 100 }] }], lines, "2026-01-31").size).toBe(0)
  })
})

describe("variance split on lines billed per cost code", () => {
  it("gives a synced line its cost code's variances, never more than its changes", () => {
    const split = varianceSplitter<{ costCode: string; assemblyKey: string | null; totalChanges: number }>([
      { costCode: "06 10 00", assemblyKey: "asm:a", varianceCents: 3_000 },
      { costCode: "06 10 00", assemblyKey: "asm:b", varianceCents: 2_000 },
    ])
    expect(split({ costCode: "06 10 00", assemblyKey: null, totalChanges: 40 }).totalVariances).toBe(40)
    expect(split({ costCode: "06 10 00", assemblyKey: null, totalChanges: 40 }).totalVariances).toBe(10)
    expect(split({ costCode: "06 10 00", assemblyKey: "asm:a", totalChanges: 30 }).totalVariances).toBe(30)
  })
})

describe("pay request origin setting", () => {
  it("defaults to Compass, including for companies saved before the setting existed", () => {
    expect(DEFAULT_SAGE_EXPORT_SETTINGS.payRequestsCreatedIn).toBe("compass")
    expect(parseFeatureSettings("sage-export", JSON.stringify({ billingCycle: "1MO" })).payRequestsCreatedIn).toBe("compass")
    expect(parseFeatureSettings("sage-export", JSON.stringify({ payRequestsCreatedIn: "sage" })).payRequestsCreatedIn).toBe("sage")
  })
})
