import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { comparePhotoDates, resolveProjectPhotoDate } from "@/lib/photos/date"

describe("project photo dates", () => {
  it("uses the original Buildertrend date ahead of capture and log dates", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: "buildertrend",
      sourceDate: "2025-12-09",
      capturedAt: "2025-12-07T23:24:00Z",
      logDate: "2025-12-08",
    })).toBe("2025-12-09")
  })

  it("preserves a source calendar date without applying a timezone conversion", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: "buildertrend", sourceDate: "2025-12-09", capturedAt: null, logDate: null,
    })).toBe("2025-12-09")
  })

  it("preserves the capture date ahead of an associated daily-log date", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: null,
      capturedAt: "2025-11-21T18:03:16.000Z",
      logDate: "2025-11-22",
    })).toBe("2025-11-21")
  })

  it("uses the source daily-log date when no capture date is available", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: null,
      capturedAt: null,
      logDate: "2025-11-21",
    })).toBe("2025-11-21")
  })

  it("leaves an imported photo undated when neither source date is known", () => {
    const photoDate = resolveProjectPhotoDate({ sourceSystem: null, capturedAt: null, logDate: null })
    expect(photoDate).toBeNull()
    expect(photoDate === "2026-10-28").toBe(false)
  })

  it("uses the preserved Buildertrend date for a Buildertrend photo", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: "buildertrend",
      sourceDate: "2025-06-03",
      capturedAt: "2026-10-28T15:00:00Z",
      logDate: "2025-06-04",
    })).toBe("2025-06-03")
  })

  it("leaves a Buildertrend photo undated instead of using import time or log date", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: "buildertrend",
      sourceDate: null,
      capturedAt: "2026-10-28T15:00:00Z",
      logDate: "2025-06-04",
    })).toBeNull()
    expect(resolveProjectPhotoDate({
      sourceSystem: "buildertrend",
      capturedAt: "2026-10-28T15:00:00Z",
      logDate: null,
    })).toBeNull()
  })

  it("keeps the capture and log date fallbacks for non-Buildertrend photos", () => {
    expect(resolveProjectPhotoDate({
      sourceSystem: "compass",
      sourceDate: null,
      capturedAt: "2025-11-21T18:03:16.000Z",
      logDate: "2025-11-22",
    })).toBe("2025-11-21")
    expect(resolveProjectPhotoDate({
      sourceSystem: null,
      capturedAt: null,
      logDate: "2025-11-22",
    })).toBe("2025-11-22")
  })

  it("selects the photo source system in every gallery loader", () => {
    // resolveProjectPhotoDate requires sourceSystem, so the compiler checks the
    // call sites; this guards the row selections that feed them.
    for (const file of [
      "src/app/actions/project-photos.ts",
      "src/app/actions/project-audience-preview.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8")
      expect(source, file).toMatch(/sourceSystem: dailyLogPhotos\.sourceSystem/)
      expect(source, file).toMatch(/resolveProjectPhotoDate\(/)
    }
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
