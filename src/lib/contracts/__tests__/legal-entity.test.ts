import { describe, expect, it } from "vitest"

import { projectLegalEntityName } from "@/lib/project-branding"

describe("project contract legal entities", () => {
  it("uses ORC's legal entity for O and D projects", () => {
    const expected =
      "High Performance Structures Inc. dba Open Range Construction, Ltd."
    expect(projectLegalEntityName("O")).toBe(expected)
    expect(projectLegalEntityName("D")).toBe(expected)
  })

  it("uses the Nu-Tech DBA for N projects", () => {
    expect(projectLegalEntityName("N")).toBe(
      "High Performance Structures Inc. dba Nu-Tech Systems"
    )
  })

  it("uses HPS without a DBA for H projects", () => {
    expect(projectLegalEntityName("H")).toBe("High Performance Structures Inc.")
  })
})
