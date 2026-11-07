import { describe, expect, it } from "vitest"

import { DEFAULT_SAGE_EXPORT_SETTINGS, sageExportSettingsSchema } from "@/lib/feature-settings/contract-settings"
import { compassLineKey, indexSageCatalog, mapToSageCostCode, sageLineKey, type SageCatalogEntry } from "@/lib/financials/sage-export-codes"
import {
  applicationSequence,
  payRequestDescription,
  sageChangeOrderName,
  sageChangeOrderPreviews,
  sageExportLines,
  sagePeriod,
  type SageExportSourceLine,
} from "@/lib/financials/sage-export-preview"
import { reconcileWithSage } from "@/lib/financials/sage-export-reconcile"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"

// Fictional catalog: workbook names (no record number) and Sage-read rows (record numbers).
const CATALOG: readonly SageCatalogEntry[] = [
  { code: "01 31 00", sourceCostCode: "01 31 00 - Project Management & Coordination", description: "Project Management & Coordination", sageMapped: true },
  { code: "06 10 00", sourceCostCode: "6100", description: "Rough Carpentry", sageMapped: true },
  { code: "Company Overhead", sourceCostCode: "Company Overhead", description: "Company Overhead", sageMapped: true },
  { code: "Company Margin", sourceCostCode: "34", description: "Company Margin", sageMapped: true },
  { code: "Site Plan", sourceCostCode: "Site Plan", description: "Site Plan", sageMapped: true },
  // A Compass fallback code with no Sage cost code.
  { code: "09 91 00", sourceCostCode: "09 91 00", description: "Painting", sageMapped: false },
]
const INDEX = indexSageCatalog(CATALOG)

function line(costCode: string, overrides: Partial<SageExportSourceLine> = {}): SageExportSourceLine {
  return {
    costCode,
    divisionCode: costCode.slice(0, 2),
    description: `Work ${costCode}`,
    originalEstimate: 1000,
    totalChanges: 0,
    totalVariances: 0,
    adjustedEstimate: 1000,
    previousWorkCompleted: 200,
    currentWorkCompleted: 100,
    storedMaterials: 0,
    totalCompletedStored: 300,
    retainageHeld: 0,
    balanceToFinish: 700,
    ...overrides,
  }
}

describe("Sage cost code mapping", () => {
  it("maps CSI codes by the Sage name prefix", () => {
    expect(mapToSageCostCode("01 31 00", INDEX)).toEqual({
      status: "mapped",
      by: "csi_prefix",
      sageName: "01 31 00 - Project Management & Coordination",
      sageRecordNumber: null,
    })
    expect(mapToSageCostCode("06 10 00", INDEX)).toMatchObject({ status: "mapped", by: "csi_prefix", sageName: "06 10 00 - Rough Carpentry", sageRecordNumber: "6100" })
  })

  it("maps builder fees by name, either spelling", () => {
    expect(mapToSageCostCode("Company Overhead", INDEX)).toMatchObject({ status: "mapped", by: "fee_name", sageName: "Company Overhead" })
    expect(mapToSageCostCode("99 10 00", INDEX)).toMatchObject({ status: "mapped", by: "fee_name", sageName: "Company Overhead" })
    expect(mapToSageCostCode("Company Margin", INDEX)).toMatchObject({ status: "mapped", by: "fee_name", sageRecordNumber: "34" })
  })

  it("flags codes with no Sage cost code", () => {
    expect(mapToSageCostCode("09 91 00", INDEX)).toMatchObject({ status: "unmapped" })
    expect(mapToSageCostCode("31 23 00", INDEX)).toMatchObject({ status: "unmapped" })
    expect(mapToSageCostCode("Mystery work", INDEX)).toMatchObject({ status: "unmapped" })
    expect(mapToSageCostCode("Contingency Reserve", INDEX)).toMatchObject({ status: "unmapped" })
    expect(mapToSageCostCode("Site Plan", INDEX)).toMatchObject({ status: "mapped", by: "name" })
  })

  it("keys Sage billing lines the same way as Compass lines", () => {
    expect(sageLineKey({ costCode: "1310", description: "01 31 00 - Project Management" }, INDEX)).toBe(compassLineKey("01 31 00"))
    expect(sageLineKey({ costCode: "6100", description: "Framing labor" }, INDEX)).toBe("06 10 00")
    expect(sageLineKey({ costCode: "33", description: "Company Overhead" }, INDEX)).toBe(compassLineKey("99 10 00"))
  })
})

describe("Sage invoice numbers", () => {
  const input = { projectNumber: "X-100-200", sageJobNumber: "1200" }

  it("uses the default pay request format with a two-digit application number", () => {
    expect(formatSageInvoiceNumber(DEFAULT_SAGE_EXPORT_SETTINGS.payRequestInvoiceFormat, { ...input, number: "3" })).toEqual({ value: "X-100-200-PR03", error: null })
    expect(formatSageInvoiceNumber(DEFAULT_SAGE_EXPORT_SETTINGS.depositInvoiceFormat, { ...input, number: "1" }).value).toBe("X-100-200-DEP1")
    expect(formatSageInvoiceNumber(DEFAULT_SAGE_EXPORT_SETTINGS.creditMemoInvoiceFormat, { ...input, number: "12" }).value).toBe("X-100-200-CM12")
    expect(formatSageInvoiceNumber("{job}-S{n:2}", { ...input, number: "4" }).value).toBe("1200-S04")
  })

  it("rejects numbers over Sage's 20 characters", () => {
    const result = formatSageInvoiceNumber("{project}-PAYREQUEST{n:2}", { ...input, number: "3" })
    expect(result.value).toBe("X-100-200-PAYREQUEST03")
    expect(result.error).toMatch(/20 characters/)
    expect(formatSageInvoiceNumber("{project}-PR{n:2}", { projectNumber: null, sageJobNumber: null, number: "3" }).error).toMatch(/project number/)
  })

  it("requires the document number in every format", () => {
    expect(sageExportSettingsSchema.safeParse(DEFAULT_SAGE_EXPORT_SETTINGS).success).toBe(true)
    expect(sageExportSettingsSchema.safeParse({ ...DEFAULT_SAGE_EXPORT_SETTINGS, payRequestInvoiceFormat: "{project}-PR" }).success).toBe(false)
  })

  it("describes the period", () => {
    expect(applicationSequence("03")).toBe("3")
    expect(payRequestDescription("2026-11-30")).toBe("November 2026 Pay Request")
    expect(sagePeriod("2026-02-15T10:00:00.000Z")).toEqual({ period: 2, month: "February", year: 2026 })
    expect(payRequestDescription(null)).toBeNull()
  })
})

describe("Sage export lines", () => {
  it("combines rows per cost code and splits change orders from variances", () => {
    const lines = sageExportLines(
      [
        line("06 10 00", { totalChanges: 300, totalVariances: 100, adjustedEstimate: 1300 }),
        line("06 10 00", { originalEstimate: 500, adjustedEstimate: 500 }),
        line("99 10 00"),
        line("Company Overhead"),
      ],
      INDEX
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ key: "06 10 00", scheduledCents: 150000, changeOrderCents: 20000, varianceCents: 10000, contractCents: 180000 })
    expect(lines[1]).toMatchObject({ costCode: "Company Overhead", previousCents: 40000, mapping: { status: "mapped" } })
  })
})

describe("reconciliation with Sage", () => {
  const lines = sageExportLines([line("01 31 00"), line("06 10 00"), line("Company Overhead")], INDEX)
  const header = { applicationNumber: "2", periodTo: "2026-10-31", capturedAt: "2026-11-01T12:00:00.000Z", contractSumToDate: 2500, totalCompletedStoredToDate: 450 }

  it("flags every difference and never adjusts it", () => {
    const result = reconcileWithSage({
      lines,
      compassContractToDateCents: 300000,
      index: INDEX,
      unavailableReason: "",
      sage: {
        header,
        lines: [
          { costCode: "1310", description: "01 31 00 - Project Management & Coordination", adjustedEstimate: 1000, totalCompletedStored: 200 },
          { costCode: "6100", description: "06 10 00 - Rough Carpentry", adjustedEstimate: 900, totalCompletedStored: 250 },
          { costCode: "7200", description: "07 21 00 - Insulation", adjustedEstimate: 600, totalCompletedStored: 0 },
        ],
      },
    })
    if (!result.available) throw new Error("expected Sage data")
    const byKey = new Map(result.lines.map((item) => [item.key, item]))
    expect(byKey.get("01 31 00")?.mismatch).toBe(false)
    expect(byKey.get("06 10 00")).toMatchObject({ contractDifferenceCents: 10000, previousDifferenceCents: -5000, mismatch: true })
    expect(byKey.get("Company Overhead")).toMatchObject({ presence: "compass_only", previousDifferenceCents: 20000, mismatch: true })
    expect(byKey.get("07 21 00")).toMatchObject({ presence: "sage_only", contractDifferenceCents: -60000, mismatch: true })
    expect(result.newToSage).toEqual(["Company Overhead"])
    expect(result.contractToDate).toEqual({ compassCents: 300000, sageCents: 250000, differenceCents: 50000, mismatch: true })
    expect(result.completedToDate).toEqual({ compassCents: 60000, sageCents: 45000, differenceCents: 15000, mismatch: true })
    expect(result.mismatchCount).toBe(5)
  })

  it("matches by Sage record number when Sage's description differs from the cost code name", () => {
    // Fictional: the Sage-read catalog row is record 35 "Contingency Reserve"; Sage's billing line says "Contingency".
    const index = indexSageCatalog([
      ...CATALOG,
      { code: "Contingency Reserve", sourceCostCode: "Contingency Reserve", description: "Contingency Reserve", sageMapped: true },
      { code: "35", sourceCostCode: "35", description: "Contingency Reserve", sageMapped: true },
    ])
    const compassLines = sageExportLines([line("Contingency Reserve"), line("Site Plan")], index)
    const result = reconcileWithSage({
      lines: compassLines,
      compassContractToDateCents: 200000,
      index,
      unavailableReason: "",
      sage: {
        header: { ...header, contractSumToDate: 2000, totalCompletedStoredToDate: 400 },
        lines: [
          { costCode: "35.0", description: "Contingency", adjustedEstimate: 1000, totalCompletedStored: 200 },
          // No record number Compass knows: falls back to the name.
          { costCode: "88", description: "Site Plan", adjustedEstimate: 1000, totalCompletedStored: 200 },
        ],
      },
    })
    if (!result.available) throw new Error("expected Sage data")
    expect(result.lines).toHaveLength(2)
    expect(result.lines.every((item) => item.presence === "both" && !item.mismatch)).toBe(true)
    expect(result.newToSage).toEqual([])
  })

  it("says so when Compass holds no Sage billing", () => {
    expect(reconcileWithSage({ lines, compassContractToDateCents: 0, index: INDEX, sage: null, unavailableReason: "No Sage read yet." })).toEqual({
      available: false,
      reason: "No Sage read yet.",
    })
  })
})

describe("change orders and variances for Sage", () => {
  it("prefixes variances with V- once", () => {
    expect(sageChangeOrderName("V-001", "variance")).toBe("V-001")
    expect(sageChangeOrderName("v-002", "variance")).toBe("V-002")
    expect(sageChangeOrderName("003", "variance")).toBe("V-003")
    expect(sageChangeOrderName("CO-004", "change_order")).toBe("CO-004")
  })

  it("lists lines by Sage cost code with period and Sage status", () => {
    const [variance, changeOrder] = sageChangeOrderPreviews(
      [
        { id: "co", recordType: "change_order", number: "CO-002", title: "Add deck", executedAt: "2026-10-20", sageRecordId: "88", lines: [{ costCode: "06 10 00", amountCents: 50000 }] },
        {
          id: "var",
          recordType: "variance",
          number: "001",
          title: "Allowance overrun",
          executedAt: "2026-09-05",
          sageRecordId: null,
          lines: [
            { costCode: "06 10 00", amountCents: 10000 },
            { costCode: "99 10 00", amountCents: 1000 },
            { costCode: "Company Overhead", amountCents: 500 },
          ],
        },
      ],
      INDEX
    )
    expect(variance).toMatchObject({ sageName: "V-001", amountCents: 11500, inSage: "unknown", period: { period: 9, month: "September", year: 2026 } })
    expect(variance?.lines.map((item) => [item.costCode, item.amountCents])).toEqual([["06 10 00", 10000], ["Company Overhead", 1500]])
    expect(changeOrder).toMatchObject({ sageName: "CO-002", inSage: "linked" })
  })
})
