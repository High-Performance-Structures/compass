import { describe, expect, it } from "vitest"

import { projectDepartment } from "@/lib/project-branding"
import { socialDepartment, socialPlatform } from "@/lib/social/types"

describe("social destination routing", () => {
  it("uses the project-number department", () => {
    expect(projectDepartment({ projectNumber: "O-214-32" })).toBe("O")
    expect(projectDepartment({ projectNumber: "H-114-09" })).toBe("H")
    expect(projectDepartment({ projectNumber: "N-017-11" })).toBe("N")
    expect(projectDepartment({ projectNumber: "D-005-02" })).toBe("D")
  })

  it("rejects unknown account routing values", () => {
    expect(socialDepartment("Z")).toBeNull()
    expect(socialPlatform("twitter")).toBeNull()
    expect(socialPlatform("x")).toBe("x")
  })
})
