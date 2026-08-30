import { describe, expect, it } from "vitest"

import { projectDepartment } from "@/lib/project-branding"
import {
  isExpectedFacebookPage,
  isExpectedInstagramProfile,
  isExpectedXProfile,
  socialDepartment,
  socialDepartmentDestination,
  socialPlatform,
} from "@/lib/social/types"

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

  it("pins each department to its approved Facebook Page and X profile", () => {
    expect(socialDepartmentDestination("H")).toEqual({
      facebookPageName: "High Performance Structures, Inc.",
      instagramUsername: "hpscolorado",
      xHandle: "@HPSColorado",
    })
    expect(socialDepartmentDestination("N").xHandle).toBe("@NutechColorado")
    expect(socialDepartmentDestination("O").facebookPageName).toBe(
      "Open Range Custom Builders",
    )
    expect(socialDepartmentDestination("D")).toEqual(
      socialDepartmentDestination("O"),
    )
    expect(isExpectedFacebookPage("H", "High Performance Structures, Inc.")).toBe(true)
    expect(isExpectedFacebookPage("H", "Nu-Tech Systems")).toBe(false)
    expect(isExpectedInstagramProfile("O", "orconstructionltd")).toBe(true)
    expect(isExpectedInstagramProfile("O", "hpscolorado")).toBe(false)
    expect(isExpectedXProfile("N", "nutechcolorado")).toBe(true)
    expect(isExpectedXProfile("N", "HPSColorado")).toBe(false)
  })
})
