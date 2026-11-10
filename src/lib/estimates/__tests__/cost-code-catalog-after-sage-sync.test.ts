import { describe, expect, it } from "vitest"

import { resolveCatalogCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { planSageCostCodeSync, type SageCostCodeRecord } from "@/lib/domain/sage-bridge/cost-code-sync-rules"
import { projectEstimateCostCodeCatalog, type EstimateSageCostCode } from "@/lib/estimates/project-cost-code-catalog"
import { autoMapPlanSwiftColumns, normalizePlanSwiftRows } from "@/lib/estimates/planswift-import"
import { indexSageCatalog, mapToSageCostCode } from "@/lib/financials/sage-export-codes"
import { parseProjectTotalsRows } from "@/lib/financials/project-totals-import"
import { nuTechProductCostCode } from "@/lib/nutech/freight"
import type { SageEstimateCatalogRow } from "@/lib/estimates/sage-estimate-cost-code-catalog"

/*
 * After the Sage cost code sync, every way a cost code reaches Compass still
 * finds its catalog row and the exact Sage record: CSI-template and PlanSwift
 * imports by code (detail codes too), Nu-Tech products and settings by Sage
 * name, and builder fees by name. Synthetic codes only.
 */

const SAGE: SageCostCodeRecord[] = [
  { recordNumber: "3000000", name: "03 00 00 - CONCRETE" },
  { recordNumber: "3111900", name: "03 11 19 - Insulating Concrete Forming" },
  // Bare product names: the Fox block range keeps them after the rename.
  { recordNumber: "3112060", name: "Fox-S800" },
  { recordNumber: "3112094", name: "ICF Shipping" },
  { recordNumber: "9000000", name: "09 00 00 - FINISHES" },
  { recordNumber: "9300000", name: "09 30 00 - Tiling" },
  // One unrenamed, one renamed detail code.
  { recordNumber: "9300103", name: "Tile Labor" },
  { recordNumber: "9300115", name: "09 30 01.15 - Tub/Shower Tile Vapor Barrier" },
  { recordNumber: "34", name: "Company Overhead" },
]

// The catalog workbook as Compass ships it: full Sage names and named items.
const WORKBOOK: SageEstimateCatalogRow[] = [
  ["03 11 19 - Insulating Concrete Forming", "3", "03", "Concrete"],
  ["Fox-S800", "3", "03", "Concrete"],
  ["ICF Shipping", "3", "03", "Concrete"],
  ["09 30 00 - Tiling", "9", "09", "Finishes"],
  ["Tile Labor", "9", "09", "Finishes"],
  ["Company Overhead", "100", "00", "Procurement Requirements"],
]

function syncedCatalog(records: readonly SageCostCodeRecord[] = SAGE) {
  const planned = planSageCostCodeSync({ records, existing: [] })
  if (!planned.success) throw new Error(planned.error)
  const rows: EstimateSageCostCode[] = planned.plan.inserts.map((row) => ({ ...row, sourceSystem: "sage" }))
  const catalog = projectEstimateCostCodeCatalog(rows, [{ sourceSystem: "sage_read_snapshot", costCode: "34.000", description: "Company Overhead", divisionName: "" }], WORKBOOK)
  return { catalog, byCode: new Map(catalog.map((row) => [row.code, row])) }
}

describe("cost code catalog after the Sage sync", () => {
  it("resolves CSI-template import codes, detail codes included", () => {
    const { byCode } = syncedCatalog()
    const parsed = parseProjectTotalsRows([
      ["09 30 00 - Tiling", null, null, null, 100],
      ["09 30 01.03 - Tile Labor", null, null, null, 50],
      ["09 30 01.15 - Tub/Shower Tile Vapor Barrier", null, null, null, 25],
      ["Project Total:", null, null, null, 175],
    ])
    if (!parsed.success) throw new Error(parsed.error)
    expect(parsed.lines.map((line) => line.costCode)).toEqual(["09 30 00", "09 30 01.03", "09 30 01.15"])
    expect(parsed.lines.map((line) => resolveCatalogCostCode(byCode, line.costCode))).toEqual([
      expect.objectContaining({ code: "09 30 00", sourceCostCode: "9300000", sageMapped: true }),
      expect.objectContaining({ code: "09 30 01.03", description: "Tile Labor", sourceCostCode: "9300103", sageMapped: true }),
      expect.objectContaining({ code: "09 30 01.15", description: "Tub/Shower Tile Vapor Barrier", sourceCostCode: "9300115", sageMapped: true }),
    ])
  })

  it("resolves PlanSwift rows by code, with or without the name", () => {
    const { byCode } = syncedCatalog()
    const headers = ["Cost Code", "Title", "Quantity", "Unit", "Unit Cost"]
    const rows = normalizePlanSwiftRows(
      [headers, ["09 30 01.03", "Tile labor", 2, "HR", 50], ["09 30 01.15 - Tub/Shower Tile Vapor Barrier", "Membrane", 1, "EA", 80], ["Fox-S800", "Blocks", 10, "EA", 5]],
      0,
      autoMapPlanSwiftColumns(headers)
    )
    expect(rows.map((row) => row.costCode)).toEqual(["09 30 01.03", "09 30 01.15", "Fox-S800"])
    expect(rows.map((row) => resolveCatalogCostCode(byCode, row.costCode)?.code)).toEqual(["09 30 01.03", "09 30 01.15", "Fox-S800"])
  })

  it("keeps Nu-Tech product and settings names resolving to the exact Sage record", () => {
    const { catalog, byCode } = syncedCatalog()
    const index = indexSageCatalog(catalog)
    const product = nuTechProductCostCode({ sageCode: null, sageCostCodeName: "Fox-S800" })
    expect(product).toBe("Fox-S800")
    expect(resolveCatalogCostCode(byCode, "Fox-S800")).toMatchObject({ sourceCostCode: "3112060", sageMapped: true })
    // The numbered choice for the same Sage record is offered too.
    expect(byCode.get("03 11 20.60")).toMatchObject({ description: "Fox-S800", sourceCostCode: "3112060" })
    for (const [code, recordNumber] of [["Fox-S800", "3112060"], ["ICF Shipping", "3112094"], ["03 11 19", "3111900"], ["03 11 20.60", "3112060"]]) {
      expect(mapToSageCostCode(code ?? "", index), code).toMatchObject({ status: "mapped", sageRecordNumber: recordNumber })
    }
  })

  it("keeps builder fees mapped by name", () => {
    const { catalog } = syncedCatalog()
    expect(mapToSageCostCode("Company Overhead", indexSageCatalog(catalog))).toMatchObject({ status: "mapped", by: "fee_name", sageRecordNumber: "34" })
  })

  it("keeps resolving after Sage's names gain the code prefix", () => {
    const renamed = SAGE.map((record) =>
      record.recordNumber === "9300103" ? { ...record, name: "09 30 01.03 - Tile Labor" } : record.recordNumber === "3112094" ? { ...record, name: "03 11 20.94 - ICF Shipping" } : record
    )
    const { catalog, byCode } = syncedCatalog(renamed)
    expect(byCode.get("09 30 01.03")).toMatchObject({ description: "Tile Labor", sourceCostCode: "9300103" })
    expect(resolveCatalogCostCode(byCode, "Tile Labor")).toMatchObject({ sourceCostCode: "9300103" })
    expect(mapToSageCostCode("ICF Shipping", indexSageCatalog(catalog))).toMatchObject({ status: "mapped", sageRecordNumber: "3112094" })
  })
})

describe("Sage export name matching", () => {
  it("finds a renamed Sage name by its bare name", () => {
    const index = indexSageCatalog([
      { code: "03 11 20.28", sourceCostCode: "03 11 20.28 - Fox-S800", description: "03 11 20.28 - Fox-S800", sageMapped: true },
      { code: "00 72 34", sourceCostCode: "00 72 34 - Company Overhead", description: "00 72 34 - Company Overhead", sageMapped: true },
    ])
    expect(mapToSageCostCode("Fox-S800", index)).toMatchObject({ status: "mapped", by: "name", sageName: "03 11 20.28 - Fox-S800" })
    expect(mapToSageCostCode("fox-s800", index)).toMatchObject({ status: "mapped" })
    expect(mapToSageCostCode("Company Overhead", index)).toMatchObject({ status: "mapped", by: "fee_name" })
    expect(mapToSageCostCode("03 11 20.28 - Fox-S800", index)).toMatchObject({ status: "mapped", by: "csi_prefix" })
    expect(mapToSageCostCode("Fox-S900", index)).toMatchObject({ status: "unmapped" })
  })
})
