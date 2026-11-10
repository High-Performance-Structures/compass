import { describe, expect, it } from "vitest"

import { mergeRoomNames } from "@/lib/domain/selections/room-options"

describe("mergeRoomNames", () => {
  it("puts the job's rooms first, then the company's, each sorted A to Z", () => {
    expect(mergeRoomNames(["Office", "Kitchen"], ["Garage", "Bath 2", "Bath 10"])).toEqual([
      "Kitchen",
      "Office",
      "Bath 2",
      "Bath 10",
      "Garage",
    ])
  })

  it("trims, drops blanks and de-duplicates without case, keeping the job's spelling", () => {
    expect(mergeRoomNames([" kitchen ", "", null, "Kitchen"], ["KITCHEN", undefined, "  ", "Pantry", "pantry"])).toEqual([
      "kitchen",
      "Pantry",
    ])
  })

  it("still offers the company's rooms on a new job", () => {
    expect(mergeRoomNames([], ["Primary Bath", "Kitchen"])).toEqual(["Kitchen", "Primary Bath"])
  })

  it("caps the list", () => {
    expect(mergeRoomNames(["b", "a"], ["c", "d"], 3)).toEqual(["a", "b", "c"])
  })
})
