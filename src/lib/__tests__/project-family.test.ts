import { describe, expect, it } from "vitest"

import {
  projectFamilyPhaseDriveFolderName,
  projectFamilyPhaseNumber,
  projectFamilyProjectNumber,
} from "@/lib/project-family"

describe("project family numbering", () => {
  it("keeps the original project unsuffixed and suffixes additional phases", () => {
    expect(projectFamilyPhaseNumber(1)).toBeNull()
    expect(projectFamilyPhaseNumber(2)).toBe(1)
    expect(projectFamilyPhaseNumber(3)).toBe(2)
    expect(projectFamilyProjectNumber("O-64-660", 1)).toBe("O-64-660")
    expect(projectFamilyProjectNumber("O-64-660", 2)).toBe("O-64-660-1")
    expect(projectFamilyProjectNumber("O-64-660", 3)).toBe("O-64-660-2")
  })

  it("normalizes a phased base and creates a safe Drive folder name", () => {
    expect(projectFamilyProjectNumber("O-64-660-1", 3)).toBe("O-64-660-2")
    expect(
      projectFamilyPhaseDriveFolderName({
        projectNumber: "O-64-660-1",
        phaseName: "Roof / exterior",
      }),
    ).toBe("O-64-660-1 - Roof - exterior")
  })
})
