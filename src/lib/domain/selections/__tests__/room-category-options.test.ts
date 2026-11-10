import { describe, expect, it } from "vitest"

import {
  buildSelectionRoomCategoryOptions,
  mergePickerNames,
} from "@/lib/domain/selections/room-category-options"

describe("mergePickerNames", () => {
  it("puts the job's names first, then the company's, each sorted A to Z", () => {
    expect(mergePickerNames(["Office", "Kitchen"], ["Garage", "Bath 2", "Bath 10"])).toEqual([
      "Kitchen",
      "Office",
      "Bath 2",
      "Bath 10",
      "Garage",
    ])
  })

  it("trims, drops blanks and de-duplicates without case, keeping the job's spelling", () => {
    expect(mergePickerNames([" kitchen ", "", null, "Kitchen"], ["KITCHEN", undefined, "  ", "Pantry", "pantry"])).toEqual([
      "kitchen",
      "Pantry",
    ])
  })

  it("leaves out excluded names in any case", () => {
    expect(mergePickerNames(["uncategorized"], ["Uncategorized", "Tile"], { exclude: ["Uncategorized"] })).toEqual(["Tile"])
  })

  it("caps the list", () => {
    expect(mergePickerNames(["b", "a"], ["c", "d"], { limit: 3 })).toEqual(["a", "b", "c"])
  })
})

describe("buildSelectionRoomCategoryOptions", () => {
  it("merges company rooms and categories with the Settings lead-time categories", () => {
    expect(
      buildSelectionRoomCategoryOptions({
        jobRooms: ["Primary Bath"],
        companyRooms: ["Kitchen", "primary bath"],
        jobCategories: ["Uncategorized", "Plumbing"],
        companyCategories: ["Flooring", "plumbing"],
        leadTimeCategories: ["Lighting", "Tile", "flooring"],
      })
    ).toEqual({
      rooms: ["Primary Bath", "Kitchen"],
      categories: ["Plumbing", "Flooring", "Lighting", "Tile"],
    })
  })

  it("still offers company names on a new job with no selections", () => {
    expect(
      buildSelectionRoomCategoryOptions({
        jobRooms: [],
        companyRooms: ["Kitchen"],
        jobCategories: [],
        companyCategories: [],
        leadTimeCategories: ["Tile"],
      })
    ).toEqual({ rooms: ["Kitchen"], categories: ["Tile"] })
  })
})
