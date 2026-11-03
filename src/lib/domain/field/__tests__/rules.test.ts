import { describe, expect, it } from "vitest"

import type { OwnerUpdateScheduleSelection, OwnerUpdateTodoSelection } from "@/lib/owner-updates/snapshot"
import { MAX_PHOTO_UPLOAD_BATCH_BYTES, MAX_PHOTO_UPLOAD_FILE_BYTES } from "@/lib/photos/upload-limits"

import {
  dailyLogIdsInPeriod,
  fahrenheitFromCelsius,
  inchesFromMeters,
  inchesText,
  isPhotoInOwnerUpdateScope,
  isTodayOrFuture,
  latestPhotoOrder,
  normalizedDailyLogReviewStatus,
  normalizedLogDate,
  normalizedPhotoKind,
  normalizedPhotoReviewStatus,
  optionalText,
  ownerFacingDailyLogNotes,
  ownerUpdateSummaryFromLogs,
  ownerUpdateTitleFromLogs,
  ownerUpdateWeatherLabel,
  parseIdList,
  personDisplayName,
  photoReviewPhotoCount,
  photoUploadSizeCheck,
  reconcileSubmittedTodos,
  reconciledScheduleItems,
  requiredText,
  submittedIdList,
  uniqueSchedulePhases,
  weatherCodeLabel,
  weatherLabel,
} from "../rules"

describe("id lists", () => {
  it("parses stored JSON id lists, dropping blanks, duplicates and non-strings", () => {
    expect(parseIdList(null)).toEqual([])
    expect(parseIdList("not json")).toEqual([])
    expect(parseIdList('{"a":1}')).toEqual([])
    expect(parseIdList('[" a ", "b", "a", "", 3]')).toEqual(["a", "b"])
  })

  it("de-duplicates submitted ids before trimming, as the editor always has", () => {
    expect(submittedIdList(["a", " a", "", "  ", "b"])).toEqual(["a", "a", "b"])
  })
})

describe("daily log text", () => {
  it("names the author by display name, then full name, then email", () => {
    expect(personDisplayName({ displayName: "Pat", firstName: "P", lastName: "Q", email: "p@x.test" })).toBe("Pat")
    expect(personDisplayName({ displayName: null, firstName: "Pat", lastName: "Quinn", email: "p@x.test" })).toBe("Pat Quinn")
    expect(personDisplayName({ displayName: null, firstName: "", lastName: null, email: "p@x.test" })).toBe("p@x.test")
  })

  it("normalizes review statuses", () => {
    expect(normalizedDailyLogReviewStatus("approved")).toBe("approved")
    expect(normalizedDailyLogReviewStatus("draft")).toBe("draft")
    expect(normalizedDailyLogReviewStatus("bogus")).toBe("needs_review")
    expect(normalizedPhotoReviewStatus("rejected")).toBe("rejected")
    expect(normalizedPhotoReviewStatus("draft")).toBe("needs_review")
    expect(normalizedPhotoKind("delivery")).toBe("delivery")
    expect(normalizedPhotoKind("")).toBe("progress")
  })

  it("requires text and dates with the messages the form shows", () => {
    expect(requiredText("  Framing  ", "Work completed")).toBe("Framing")
    expect(() => requiredText("   ", "Work completed")).toThrow("Work completed is required.")
    expect(optionalText("  ")).toBeNull()
    expect(optionalText(" x ")).toBe("x")
    expect(normalizedLogDate(" 2026-10-30 ")).toBe("2026-10-30")
    expect(() => normalizedLogDate("10/30/2026")).toThrow("Enter a valid daily log date.")
  })

  it("hides Buildertrend import markers from owners", () => {
    expect(ownerFacingDailyLogNotes("  ")).toBeNull()
    expect(ownerFacingDailyLogNotes("Buildertrend title: Day 4")).toBeNull()
    expect(ownerFacingDailyLogNotes("Notes\nBuildertrend job ID: 9")).toBeNull()
    expect(ownerFacingDailyLogNotes(" Pour Friday ")).toBe("Pour Friday")
  })

  it("lists schedule phases once each, trimmed, in order", () => {
    expect(uniqueSchedulePhases([" Framing", "", "Roofing", "Framing "])).toEqual(["Framing", "Roofing"])
  })
})

describe("weather", () => {
  it("converts units and labels codes", () => {
    expect(fahrenheitFromCelsius(null)).toBeNull()
    expect(fahrenheitFromCelsius(20)).toBe(68)
    expect(inchesFromMeters(0)).toBeNull()
    expect(inchesFromMeters(0.001)).toBe("0.04 in last hour")
    expect(inchesFromMeters(0.01)).toBe("0.4 in last hour")
    expect(inchesText(0.05, "rain")).toBe("0.05 in rain")
    expect(inchesText(1.25, "snow")).toBe("1.3 in snow")
    expect(weatherCodeLabel(0)).toBe("Clear")
    expect(weatherCodeLabel(81)).toBe("Rain showers")
    expect(weatherCodeLabel(null)).toBe("Historical weather")
  })

  it("uses live weather for today and later", () => {
    expect(isTodayOrFuture("2026-10-30", "2026-10-30")).toBe(true)
    expect(isTodayOrFuture("2026-10-29", "2026-10-30")).toBe(false)
  })

  it("formats the log's weather, and the owner update's shorter version", () => {
    const row = { weatherConditions: "Clear", weatherTempF: 72, weatherPrecipitation: "None recorded" }
    expect(weatherLabel(row)).toBe("Clear, 72F, None recorded")
    expect(weatherLabel({ weatherConditions: "", weatherTempF: null, weatherPrecipitation: null })).toBeNull()
    expect(ownerUpdateWeatherLabel(row)).toBe("Clear, 72F")
    expect(ownerUpdateWeatherLabel({ weatherConditions: null, weatherTempF: null })).toBeNull()
  })
})

describe("photos", () => {
  it("checks each file, then the batch", () => {
    const big = { name: "big.jpg", size: MAX_PHOTO_UPLOAD_FILE_BYTES + 1 }
    const half = { name: "half.jpg", size: Math.floor(MAX_PHOTO_UPLOAD_BATCH_BYTES / 2) + 1 }
    expect(photoUploadSizeCheck([])).toEqual({ ok: true, totalBytes: 0 })
    expect(photoUploadSizeCheck([{ name: "a", size: 10 }])).toEqual({ ok: true, totalBytes: 10 })
    expect(photoUploadSizeCheck([big])).toMatchObject({ ok: false, reason: "file", file: big })
    expect(photoUploadSizeCheck([half, half])).toEqual({
      ok: false,
      reason: "batch",
      totalBytes: half.size * 2,
    })
  })

  it("reads the photo count from review folder metadata", () => {
    expect(photoReviewPhotoCount(null)).toBeNull()
    expect(photoReviewPhotoCount("{")).toBeNull()
    expect(photoReviewPhotoCount('{"photo_count":12}')).toBe(12)
    expect(photoReviewPhotoCount('{"photo_count":"12"}')).toBeNull()
  })

  it("orders thumbnails, then images, then other files", () => {
    const ordered = latestPhotoOrder([
      { id: "pdf", thumbnailUrl: null, mimeType: "application/pdf" },
      { id: "image", thumbnailUrl: null, mimeType: "image/jpeg" },
      { id: "thumb", thumbnailUrl: "/t", mimeType: null },
    ])
    expect(ordered.map((photo) => photo.id)).toEqual(["thumb", "image", "pdf"])
  })
})

describe("owner updates", () => {
  it("scopes files to source logs or the reporting period", () => {
    const logs = new Set(["log-1"])
    expect(isPhotoInOwnerUpdateScope({ dailyLogId: "log-1", capturedAt: null }, logs, "2026-10-01", "2026-10-07")).toBe(true)
    expect(isPhotoInOwnerUpdateScope({ dailyLogId: null, capturedAt: "2026-10-03T12:00:00Z" }, logs, "2026-10-01", "2026-10-07")).toBe(true)
    expect(isPhotoInOwnerUpdateScope({ dailyLogId: "log-2", capturedAt: "2026-10-09T12:00:00Z" }, logs, "2026-10-01", "2026-10-07")).toBe(false)
    expect(
      [...dailyLogIdsInPeriod(
        [
          { id: "a", logDate: "2026-09-30" },
          { id: "b", logDate: "2026-10-01" },
        ],
        "2026-10-01",
        "2026-10-07"
      )]
    ).toEqual(["b"])
  })

  it("titles and summarizes a draft made from logs", () => {
    expect(ownerUpdateTitleFromLogs("O-1", "2026-10-01", "2026-10-01")).toBe("O-1 Update - 2026-10-01")
    expect(ownerUpdateTitleFromLogs("O-1", "2026-10-01", "2026-10-03")).toBe("O-1 Update - 2026-10-01 to 2026-10-03")
    expect(ownerUpdateSummaryFromLogs([{ workCompleted: "A" }, { workCompleted: "B" }])).toBe("A B")
    expect(ownerUpdateSummaryFromLogs([{ workCompleted: "x".repeat(1000) }])).toHaveLength(900)
  })

  it("refreshes saved schedule picks from the live schedule, keeping title and notes", () => {
    const live: OwnerUpdateScheduleSelection = {
      id: "t1",
      title: "Frame walls",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      assignedTo: "Crew A",
      status: "complete",
      percentComplete: 100,
      notes: "",
    }
    const saved: OwnerUpdateScheduleSelection = { ...live, title: "Framing", status: "in_progress", percentComplete: 40, notes: "Owner note" }
    const byDates: OwnerUpdateScheduleSelection = { ...live, id: "old-id", title: "Frame walls", notes: "x" }
    const missing: OwnerUpdateScheduleSelection = { ...live, id: "gone", title: "Gone", startDate: "2026-01-01" }
    expect(reconciledScheduleItems([saved, byDates, missing], [live])).toEqual([
      { ...live, title: "Framing", notes: "Owner note" },
      { ...live, title: "Frame walls", notes: "x" },
      missing,
    ])
  })

  it("keeps submitted to-dos only when still candidates, once each", () => {
    const candidate: OwnerUpdateTodoSelection = {
      id: "todo-1",
      title: "Order windows",
      description: "",
      status: "open",
      priority: "normal",
      assigneeName: null,
      companyName: null,
      dueDate: "2026-10-10",
      timing: "upcoming",
      notes: "",
    }
    expect(
      reconcileSubmittedTodos(
        [
          { id: "todo-1", title: "  ", description: " Lead time ", notes: " Call vendor " },
          { id: "todo-1", title: "Second", description: "", notes: "" },
          { id: "unknown", title: "x", description: "", notes: "" },
        ],
        [candidate]
      )
    ).toEqual([{ ...candidate, description: "Lead time", notes: "Call vendor" }])
  })
})
