import { describe, expect, it } from "vitest"
import { projectDisplayName } from "@/lib/project-display-name"

describe("projectDisplayName", () => {
  it("removes a doubled job number from the start of the name", () => {
    expect(projectDisplayName({ name: "O-170-2684 - O-170-2684 County Ln 7 - Loomis", projectNumber: "O-170-2684" })).toBe(
      "County Ln 7 - Loomis",
    )
  })

  it("removes a single leading job number and its separator", () => {
    expect(projectDisplayName({ name: "H-430-1900 Ezell Residence", projectNumber: "H-430-1900" })).toBe("Ezell Residence")
    expect(projectDisplayName({ name: "D-18-00: Squires / Ridge Rd", projectNumber: "D-18-00" })).toBe("Squires / Ridge Rd")
  })

  it("removes a job number even when it differs from the record's", () => {
    expect(projectDisplayName({ name: "O-202-595 - Bigley Remodel", projectNumber: null })).toBe("Bigley Remodel")
  })

  it("keeps names that do not start with a job number", () => {
    expect(projectDisplayName({ name: "Office Remodel", projectNumber: "H-OFFICE" })).toBe("Office Remodel")
    expect(projectDisplayName({ name: "Highway 40 Shop", projectNumber: "O-1" })).toBe("Highway 40 Shop")
  })

  it("does not strip a word that only looks like a department prefix", () => {
    expect(projectDisplayName({ name: "H-Frame Barn", projectNumber: null })).toBe("H-Frame Barn")
  })

  it("falls back to the job number when nothing else remains", () => {
    expect(projectDisplayName({ name: "O-170-2684", projectNumber: "O-170-2684" })).toBe("O-170-2684")
  })
})
