import { describe, expect, it } from "vitest"

import { comparePhotoDates, resolveProjectPhotoDate } from "@/lib/photos/date"

describe("project photo dates", () => {
  it("preserves the capture date ahead of an associated daily-log date", () => {
    expect(resolveProjectPhotoDate({
      capturedAt: "2025-11-21T18:03:16.000Z",
      logDate: "2025-11-22",
    })).toBe("2025-11-21")
  })

  it("uses the source daily-log date when no capture date is available", () => {
    expect(resolveProjectPhotoDate({
      capturedAt: null,
      logDate: "2025-11-21",
    })).toBe("2025-11-21")
  })

  it("leaves an imported photo undated when neither source date is known", () => {
    const photoDate = resolveProjectPhotoDate({ capturedAt: null, logDate: null })
    expect(photoDate).toBeNull()
    expect(photoDate === "2026-10-28").toBe(false)
  })

  it("keeps undated photos last for both oldest-first and newest-first views", () => {
    const dates = [null, "2026-01-02", "2025-11-21", null]
    expect(dates.toSorted((left, right) => comparePhotoDates(left, right, "asc")))
      .toEqual(["2025-11-21", "2026-01-02", null, null])
    expect(dates.toSorted((left, right) => comparePhotoDates(left, right, "desc")))
      .toEqual(["2026-01-02", "2025-11-21", null, null])
    expect(dates).toEqual([null, "2026-01-02", "2025-11-21", null])
  })
})
