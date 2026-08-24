import { describe, expect, it } from "vitest"

import {
  ORC_CONTRACT_SOURCE_DEFINITIONS,
  contractSourceRanges,
  normalizeContractSourceDocument,
} from "@/lib/contracts/source"

describe("contract source normalization", () => {
  it("builds bounded reads for every source sheet", () => {
    const ranges = contractSourceRanges()
    expect(ranges.some((item) => item.sheetName === "CA00 Cost Plus")).toBe(true)
    expect(ranges.some((item) => item.sheetName === "CA11 Inspection Check List (3)")).toBe(true)
    expect(ranges.every((item) => !item.range.includes("1000"))).toBe(true)
  })

  it("replaces CA00's static document list with the packet schedule token", () => {
    const definition = ORC_CONTRACT_SOURCE_DEFINITIONS.find(
      (item) => item.code === "CA00"
    )
    expect(definition).toBeDefined()
    if (!definition) return
    const rows = Array.from({ length: 125 }, () => [] as readonly unknown[])
    rows[24] = ["Article 1. CONTRACT DOCUMENTS"]
    rows[25] = ["Article 1.1 Source text"]
    rows[26] = ["Article 1.2 Specific contract documents include:"]
    const content = normalizeContractSourceDocument({
      definition,
      rows: { "CA00 Cost Plus": rows },
    })
    expect(content).toContain("{{contract.document_schedule}}")
    expect(content).not.toContain("CA07")
  })

  it("keeps the handbook as a reference instead of embedded content", () => {
    const definition = ORC_CONTRACT_SOURCE_DEFINITIONS.find(
      (item) => item.code === "CA18"
    )
    expect(definition).toBeDefined()
    if (!definition) return
    expect(definition.defaultInclusionMode).toBe("reference")
    expect(normalizeContractSourceDocument({ definition, rows: {} })).toContain(
      "not embedded"
    )
  })

  it("marks the inspection checklist for closeout signing", () => {
    const definition = ORC_CONTRACT_SOURCE_DEFINITIONS.find(
      (item) => item.code === "CA11"
    )
    expect(definition?.signingStage).toBe("closeout")
  })
})
