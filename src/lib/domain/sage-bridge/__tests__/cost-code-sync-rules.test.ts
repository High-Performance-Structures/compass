import { describe, expect, it } from "vitest"

import {
  csiCodeFromSageRecordNumber,
  isCatalogSageCostCode,
  mapSageCostCode,
  planSageCostCodeSync,
  sageCostCodeNameWithoutCode,
  type ExistingSageCostCode,
  type SageCostCodeRecord,
} from "@/lib/domain/sage-bridge/cost-code-sync-rules"

// Synthetic codes only; the real Sage list never goes in this public repo.
const noDivisions = new Map<string, string>()
const map = (recordNumber: string, name: string) =>
  mapSageCostCode({ record: { recordNumber, name }, sageDivisionNames: noDivisions, compassDivisionNames: new Map([["09", "Finishes"]]) })

function existing(overrides: Partial<ExistingSageCostCode> & Pick<ExistingSageCostCode, "id" | "code" | "description">): ExistingSageCostCode {
  return {
    sourceSystem: "sage_xlsx",
    sourceRecordId: null,
    sourceRecordNumber: overrides.code,
    displayLabel: `${overrides.code} ${overrides.description}`,
    divisionCode: overrides.code.slice(0, 2),
    divisionDescription: "Finishes",
    divisionDisplayLabel: `${overrides.code.slice(0, 2)} 00 00 Finishes`,
    active: true,
    syncStatus: "synced_local_export",
    ...overrides,
  }
}

describe("Sage cost code from record number", () => {
  it("reads AABBCCDD and drops a .00 detail", () => {
    expect(csiCodeFromSageRecordNumber("9300115")).toBe("09 30 01.15")
    expect(csiCodeFromSageRecordNumber("9300100")).toBe("09 30 01")
    expect(csiCodeFromSageRecordNumber("9290000")).toBe("09 29 00")
    expect(csiCodeFromSageRecordNumber("9300103.0")).toBe("09 30 01.03")
    expect(csiCodeFromSageRecordNumber("23700100")).toBe("23 70 01")
  })

  it("leaves non-CSI record numbers out of the catalog", () => {
    for (const recordNumber of ["1", "34", "43", "500", "507", "514", "900000000", "900000146"]) {
      expect(isCatalogSageCostCode(recordNumber), recordNumber).toBe(false)
      expect(csiCodeFromSageRecordNumber(recordNumber)).toBeNull()
    }
    expect(isCatalogSageCostCode("1000000")).toBe(true)
  })

  it("strips a leading code from renamed and unrenamed names alike", () => {
    expect(sageCostCodeNameWithoutCode("09 30 01.15 - Tub/Shower Tile Vapor Barrier")).toBe("Tub/Shower Tile Vapor Barrier")
    expect(sageCostCodeNameWithoutCode("09 30 01.15 Tub/Shower Tile Vapor Barrier")).toBe("Tub/Shower Tile Vapor Barrier")
    expect(sageCostCodeNameWithoutCode("09 30 01.15 – Tub/Shower")).toBe("Tub/Shower")
    expect(sageCostCodeNameWithoutCode("09 30 00 - TILING")).toBe("TILING")
    expect(sageCostCodeNameWithoutCode("Tub/Shower Tile Vapor Barrier")).toBe("Tub/Shower Tile Vapor Barrier")
    expect(sageCostCodeNameWithoutCode("Fox-S800")).toBe("Fox-S800")
    // A bare code keeps itself as the name rather than becoming blank.
    expect(sageCostCodeNameWithoutCode("09 30 01")).toBe("09 30 01")
  })

  it("never takes the code from the name", () => {
    expect(map("9300115", "Tub/Shower Tile Vapor Barrier")).toEqual({
      sourceRecordId: "9300115",
      code: "09 30 01.15",
      description: "Tub/Shower Tile Vapor Barrier",
      displayLabel: "09 30 01.15 Tub/Shower Tile Vapor Barrier",
      divisionCode: "09",
      divisionDescription: "Finishes",
      divisionDisplayLabel: "09 00 00 Finishes",
    })
    expect(map("9300115", "09 30 01.15 - Tub/Shower Tile Vapor Barrier")).toEqual(map("9300115", "Tub/Shower Tile Vapor Barrier"))
    // A name whose prefix disagrees still files under the record number's code.
    expect(map("3350109", "03 35 33 - Stamped Concrete Finishing")).toMatchObject({ code: "03 35 01.09", description: "Stamped Concrete Finishing" })
    expect(map("34", "Company Overhead")).toBeNull()
  })

  it("names a division from Sage when Compass has no name for it", () => {
    const value = mapSageCostCode({
      record: { recordNumber: "6110100", name: "Ceiling Framing" },
      sageDivisionNames: new Map([["06", "WOODS, PLASTICS & COMPOSITES"]]),
      compassDivisionNames: new Map(),
    })
    expect(value).toMatchObject({ divisionDescription: "Woods, Plastics & Composites", divisionDisplayLabel: "06 00 00 Woods, Plastics & Composites" })
  })
})

describe("planSageCostCodeSync", () => {
  const records: SageCostCodeRecord[] = [
    { recordNumber: "9000000", name: "09 00 00 - FINISHES" },
    { recordNumber: "9290000", name: "09 29 00 - Gypsum Board" },
    { recordNumber: "9300103", name: "Tile Labor" },
    { recordNumber: "9300115", name: "09 30 01.15 - Tub/Shower Tile Vapor Barrier" },
    { recordNumber: "34", name: "Company Overhead" },
    { recordNumber: "900000001", name: "900000001 - CLIN 001" },
  ]

  it("updates spreadsheet rows in place, adds new codes and inactivates the rest", () => {
    const result = planSageCostCodeSync({
      records,
      existing: [
        existing({ id: "sage-cost-code-09-29-00", code: "09 29 00", description: "Gypsum Board" }),
        existing({ id: "sage-cost-code-09-60-00", code: "09 60 00", description: "Flooring" }),
      ],
    })
    if (!result.success) throw new Error(result.error)
    const { plan } = result
    expect(plan.skipped).toBe(2)
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: "sage-cost-code-09-29-00", sourceRecordId: "9290000", code: "09 29 00", description: "Gypsum Board" }),
    ])
    expect(plan.inserts.map((row) => [row.id, row.code, row.description])).toEqual([
      ["sage-cost-code-r9000000", "09 00 00", "FINISHES"],
      ["sage-cost-code-r9300103", "09 30 01.03", "Tile Labor"],
      ["sage-cost-code-r9300115", "09 30 01.15", "Tub/Shower Tile Vapor Barrier"],
    ])
    expect(plan.inactivations).toEqual([{ id: "sage-cost-code-09-60-00", code: "09 60 00" }])
    expect(plan.warnings).toEqual([])
  })

  it("writes nothing for rows that already match, and follows a rename by record number", () => {
    const first = planSageCostCodeSync({ records, existing: [] })
    if (!first.success) throw new Error(first.error)
    const synced: ExistingSageCostCode[] = first.plan.inserts.map((row) => ({
      ...row,
      sourceSystem: "sage",
      sourceRecordNumber: row.sourceRecordId,
      active: true,
      syncStatus: "synced",
    }))
    const again = planSageCostCodeSync({ records, existing: synced })
    if (!again.success) throw new Error(again.error)
    expect(again.plan).toMatchObject({ inserts: [], updates: [], inactivations: [], unchanged: 4 })

    const renamed = records.map((record) => (record.recordNumber === "9300103" ? { ...record, name: "09 30 01.03 - Tile Labor" } : record))
    const afterRename = planSageCostCodeSync({ records: renamed, existing: synced })
    if (!afterRename.success) throw new Error(afterRename.error)
    // The rename only adds the code prefix, which is stripped, so nothing changes.
    expect(afterRename.plan.updates).toEqual([])

    const retitled = records.map((record) => (record.recordNumber === "9300103" ? { ...record, name: "09 30 01.03 - Tile Install Labor" } : record))
    const afterRetitle = planSageCostCodeSync({ records: retitled, existing: synced })
    if (!afterRetitle.success) throw new Error(afterRetitle.error)
    expect(afterRetitle.plan.updates).toEqual([
      expect.objectContaining({ id: "sage-cost-code-r9300103", code: "09 30 01.03", description: "Tile Install Labor", displayLabel: "09 30 01.03 Tile Install Labor" }),
    ])
  })

  it("reactivates a code Sage brings back and never re-marks an already inactive one", () => {
    const result = planSageCostCodeSync({
      records,
      existing: [
        existing({ id: "a", code: "09 29 00", description: "Gypsum Board", active: false, syncStatus: "not_in_sage" }),
        existing({ id: "b", code: "09 60 00", description: "Flooring", active: false, syncStatus: "not_in_sage" }),
      ],
    })
    if (!result.success) throw new Error(result.error)
    expect(result.plan.updates).toEqual([expect.objectContaining({ id: "a" })])
    expect(result.plan.inactivations).toEqual([])
  })

  it("warns when a name's code disagrees with its record number", () => {
    const result = planSageCostCodeSync({ records: [{ recordNumber: "3350109", name: "03 35 33 - Stamped Concrete Finishing" }], existing: [] })
    if (!result.success) throw new Error(result.error)
    expect(result.plan.warnings).toHaveLength(1)
  })

  it("refuses a read that looks incomplete or repeats a record", () => {
    const synced: ExistingSageCostCode[] = Array.from({ length: 20 }, (_, index) =>
      existing({ id: `r${index}`, code: `09 ${String(10 + index)} 00`, description: "x", sourceSystem: "sage", sourceRecordId: String(9000000 + (10 + index) * 10000) })
    )
    expect(planSageCostCodeSync({ records, existing: synced }).success).toBe(false)
    expect(planSageCostCodeSync({ records: [], existing: [] }).success).toBe(false)
    expect(planSageCostCodeSync({ records: [records[1], records[1]].filter((record) => record !== undefined), existing: [] }).success).toBe(false)
  })
})
