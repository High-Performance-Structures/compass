import { describe, expect, it } from "vitest"

import {
  normalizeProjectNumber,
  parseFinishScheduleWorkbook,
} from "@/lib/selections/google-finish-schedule-import"

describe("Google finish schedule import", () => {
  it("preserves room groupings and category headings", () => {
    const parsed = parseFinishScheduleWorkbook({
      coverPageRows: [
        ["Project", "Mitchell Residence"],
        ["Project Number", "O-210-33"],
        ["Room", "Room Type"],
        ["Living", "Living Area"],
      ],
      roomSheets: [
        {
          sheetId: 17,
          title: "Living",
          index: 2,
          values: [
            [
              "Name",
              "Description",
              "Qty",
              "Manufacturer",
              "Type/Model",
              "Color/Finish",
              "Additional Notes",
            ],
            ["WALL FINISH"],
            ["Main wall paint", "Eggshell", 12, "Sherwin-Williams", "Emerald", "Alabaster", "Confirm sample"],
            [],
            ["FLOOR FINISH"],
            ["Oak floor", "Wide plank", "430 SF", "Local Mill", "Select", "Natural", ""],
          ],
        },
      ],
    })

    expect(parsed.projectNumber).toBe("O-210-33")
    expect(parsed.rooms).toEqual([
      {
        sheetId: 17,
        sheetName: "Living",
        roomName: "Living",
        roomType: "Living Area",
        sortOrder: 2,
      },
    ])
    expect(parsed.selections).toHaveLength(2)
    expect(parsed.selections[0]).toMatchObject({
      sourceRowNumber: 3,
      category: "WALL FINISH",
      name: "Main wall paint",
      quantity: 12,
      model: "Emerald",
      colorFinish: "Alabaster",
    })
    expect(parsed.selections[1]).toMatchObject({
      sourceRowNumber: 6,
      category: "FLOOR FINISH",
      name: "Oak floor",
      quantity: 430,
    })
  })

  it("warns when a workbook cannot be tied to a project", () => {
    const parsed = parseFinishScheduleWorkbook({
      coverPageRows: [],
      roomSheets: [],
    })

    expect(parsed.projectNumber).toBeNull()
    expect(parsed.warnings).toEqual([
      "The workbook cover page has no project number.",
      "The workbook has no visible room sheets.",
    ])
  })

  it("normalizes harmless project-number formatting differences", () => {
    expect(normalizeProjectNumber(" o-210-33 ")).toBe("O21033")
    expect(normalizeProjectNumber("O 210 / 33")).toBe("O21033")
    expect(normalizeProjectNumber(null)).toBeNull()
  })
})
