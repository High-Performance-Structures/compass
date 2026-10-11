import { describe, expect, it } from "vitest"
import { classifyProjectFolderName, PROJECT_FILE_CATEGORIES } from "@/lib/project-files"

describe("project folder categories", () => {
  it.each([
    ["13_MeetingNotes", "meeting-notes"],
    ["14_EngineeringStructural", "engineering"],
    ["15_Subcontractors", "subcontractors"],
    ["16_ChangeOrders", "change-orders"],
    ["17_Warranty", "warranty"],
    ["18_ProjectBinder", "project-binder"],
    ["19_ICFBuilderAwards", "icf-awards"],
    ["20_KeyCeremony", "key-ceremony"],
    ["13_Warranty", "warranty"],
    ["Meeting Notes", "meeting-notes"],
    ["Correspondence", "communications"],
  ])("classifies the ORC and HPS folder %s", (name, key) => {
    expect(classifyProjectFolderName(name)?.key).toBe(key)
  })

  it.each([
    ["01_PlanFiles", "plans"],
    ["02_TakeOffs", "preconstruction"],
    ["03_TakeOffsEstimates", "estimate"],
    ["04_PurchaseOrders", "purchasing"],
    ["05_PayRequests", "pay-requests"],
    ["06_Communications", "communications"],
  ])("classifies the Nu-Tech order folder %s", (name, key) => {
    expect(classifyProjectFolderName(name)?.key).toBe(key)
  })

  it("never gives two categories the same folder name", () => {
    const names = PROJECT_FILE_CATEGORIES.flatMap((category) =>
      [...category.currentNames, ...category.legacyNames].map((name) => name.toLowerCase()),
    )
    // "Photos" is listed as both a current and legacy photos name.
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index && name !== "photos")
    expect(duplicates).toEqual([])
  })
})
