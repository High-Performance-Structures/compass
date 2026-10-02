import { describe, expect, it } from "vitest"
import { validateEstimateReportPhase, type EstimateReportPhaseInput } from "@/lib/estimates/report-phases"

const input: EstimateReportPhaseInput = { divisionCode: "03", name: " Fox Blocks ", description: " ICF walls ", itemize: true, sortOrder: 1, lineIds: ["forms", "forms"] }
const lines = [{ id: "forms", divisionCode: "03" }, { id: "steel", divisionCode: "05" }]

describe("report phase validation", () => {
  it("normalizes phase copy and deduplicates membership", () => {
    expect(validateEstimateReportPhase(input, lines)).toEqual({ success: true, value: { ...input, name: "Fox Blocks", description: "ICF walls", lineIds: ["forms"] } })
  })
  it("permits empty phases for later assignment", () => {
    expect(validateEstimateReportPhase({ ...input, lineIds: [] }, lines).success).toBe(true)
  })
  it("rejects membership outside the source division or estimate", () => {
    for (const lineIds of [["steel"], ["foreign-estimate-line"]]) expect(validateEstimateReportPhase({ ...input, lineIds }, lines).success).toBe(false)
  })
  it("rejects invalid copy, source divisions and report order", () => {
    for (const change of [{ name: " " }, { name: "x".repeat(161) }, { description: "x".repeat(6001) }, { divisionCode: "Concrete" }, { sortOrder: 0 }, { sortOrder: 1.5 }]) expect(validateEstimateReportPhase({ ...input, ...change }, lines).success).toBe(false)
  })
  it("does not impose a line count or dollar cap", () => {
    const manyLines = Array.from({ length: 1000 }, (_, index) => ({ id: `line-${index}`, divisionCode: "03" }))
    expect(validateEstimateReportPhase({ ...input, lineIds: manyLines.map((line) => line.id) }, manyLines).success).toBe(true)
  })
})
