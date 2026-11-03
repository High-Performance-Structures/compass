import { describe, expect, it } from "vitest"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import {
  dailyLogTodoDescription,
  draftFromLog,
  fieldElementId,
  filterValue,
  formatBytes,
  matchesFilter,
  parseUploadResponse,
  readableField,
  selectedLogIds,
  sourceLabel,
  statusLabel,
  uploadBatchSummary,
  uploadFailureMessage,
  uploadSizeProblem,
  uploadSucceeded,
  weatherFilledMessage,
  withoutErrors,
} from "@/lib/daily-logs/workspace-view"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
  PHOTO_UPLOAD_LIMIT_LABEL,
} from "@/lib/photos/upload-limits"
import { formatDate } from "@/lib/format"
import { finiteNumber } from "@/lib/shared/guards"

const baseLog: ProjectDailyLogItem = {
  id: "log-1",
  sourceSystem: "compass",
  sourceExternalId: null,
  logDate: "2026-10-30",
  weather: null,
  weatherTempF: 41,
  weatherConditions: "Cloudy",
  weatherPrecipitation: null,
  workCompleted: "Framed walls",
  issues: null,
  materialsUsed: null,
  crewPresent: null,
  hoursWorked: null,
  safetyIncidents: null,
  visitorLog: null,
  notes: null,
  isClientVisible: false,
  reviewStatus: "needs_review",
  syncStatus: "synced",
  authorName: null,
  photos: [],
  scheduleItems: [],
  todos: [],
  workLines: [],
}

describe("daily log drafts", () => {
  it("builds an edit draft with one empty line for logs without cost codes", () => {
    const draft = draftFromLog(baseLog)
    expect(draft.weatherTempF).toBe("41")
    expect(draft.crewPresent).toBe("")
    expect(draft.workLines).toEqual([{ costCode: "", hours: "", description: "" }])
  })

  it("drops a field's errors, and every line's for workLines", () => {
    const errors = new Map([
      ["workLines.0.hours", "Hours"],
      ["workLines", "Lines"],
      ["notes", "Notes"],
    ])
    expect([...withoutErrors(errors, "workLines").keys()]).toEqual(["notes"])
    expect(withoutErrors(errors, "issues")).toBe(errors)
  })

  it("points errors at their inputs", () => {
    expect(fieldElementId("daily-log", "workLines.2.costCode")).toBe("daily-log-line-2-code")
    expect(fieldElementId("daily-log", "workLines.2.hours")).toBe("daily-log-line-2-hours")
    expect(fieldElementId("daily-log", "workLines")).toBe("daily-log-line-0-code")
    expect(fieldElementId("daily-log", "clientContacts.1.contactId")).toBe("daily-log-contact-1-who")
    expect(fieldElementId("daily-log", "clientContacts.1.interactionType")).toBe("daily-log-contact-1-type")
    expect(fieldElementId("daily-log", "clientContacts.1.time")).toBe("daily-log-contact-1-time")
    expect(fieldElementId("daily-log", "safetyIncidents")).toBe("daily-log-safety")
    expect(fieldElementId("daily-log", "other")).toBe("daily-log-other")
  })

  it("reads temperatures the way the old optionalNumber did", () => {
    expect(finiteNumber("")).toBeNull()
    expect(finiteNumber("   ")).toBeNull()
    expect(finiteNumber(" 42 ")).toBe(42)
    expect(finiteNumber("warm")).toBeNull()
    expect(finiteNumber("Infinity")).toBeNull()
  })
})

describe("daily log labels", () => {
  it("formats sizes, statuses and sources", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
    expect(statusLabel("needs_review")).toBe("Needs Review")
    expect(sourceLabel("google_daily_log")).toBe("Google daily log")
    expect(sourceLabel("anything")).toBe("Compass")
  })

  it("shows date-only values the same as the old local formatDate", () => {
    const old = (value: string): string =>
      new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    for (const value of ["2026-01-01", "2026-10-30", "2025-12-31", "2024-02-29"]) {
      expect(formatDate(value)).toBe(old(value))
    }
  })

  it("turns imported JSON lists into text", () => {
    expect(readableField(null)).toBeNull()
    expect(readableField("")).toBeNull()
    expect(readableField('[{"company":"Acme","count":3},{"company":"Beta"},"Solo"]')).toBe("Acme (3), Beta, Solo")
    expect(readableField("[]")).toBe("[]")
    expect(readableField("plain text")).toBe("plain text")
  })

  it("describes a follow-up from issues, safety and notes", () => {
    expect(dailyLogTodoDescription(baseLog)).toBe("Framed walls")
    expect(dailyLogTodoDescription({ ...baseLog, issues: "Late delivery", notes: " ", safetyIncidents: "Cut" })).toBe(
      "Late delivery\n\nCut"
    )
  })
})

describe("daily log filters", () => {
  it("parses filter values and matches logs", () => {
    expect(filterValue("approved")).toBe("approved")
    expect(filterValue("bogus")).toBe("all")
    expect(matchesFilter(baseLog, "needs_review")).toBe(true)
    expect(matchesFilter(baseLog, "approved")).toBe(false)
    expect(matchesFilter({ ...baseLog, isClientVisible: true }, "owner_visible")).toBe(true)
    expect(matchesFilter(baseLog, "all")).toBe(true)
  })

  it("keeps only selected ids that are in view", () => {
    expect(selectedLogIds([baseLog], ["log-1", "log-2"])).toEqual(["log-1"])
  })
})

describe("daily log uploads", () => {
  it("names the first oversized file, then an oversized batch", () => {
    expect(uploadSizeProblem([])).toBeNull()
    expect(uploadSizeProblem([{ name: "a.jpg", size: 10 }])).toBeNull()
    expect(uploadSizeProblem([{ name: "big.jpg", size: MAX_PHOTO_UPLOAD_FILE_BYTES + 1 }])).toBe(
      `big.jpg is ${formatBytes(MAX_PHOTO_UPLOAD_FILE_BYTES + 1)}. ${PHOTO_UPLOAD_LIMIT_LABEL}`
    )
    const count = Math.ceil(MAX_PHOTO_UPLOAD_BATCH_BYTES / MAX_PHOTO_UPLOAD_FILE_BYTES) + 1
    const files = Array.from({ length: count }, (_, index) => ({ name: `f${index}`, size: MAX_PHOTO_UPLOAD_FILE_BYTES }))
    expect(uploadSizeProblem(files)).toBe(
      `${formatBytes(count * MAX_PHOTO_UPLOAD_FILE_BYTES)} selected. ${PHOTO_UPLOAD_LIMIT_LABEL}`
    )
  })

  it("reads upload responses, including non-JSON rejections", () => {
    expect(parseUploadResponse('{"success":true}')).toEqual({ success: true })
    expect(parseUploadResponse("<html>")).toBeNull()
    expect(uploadSucceeded(true, { success: true })).toBe(true)
    expect(uploadSucceeded(false, { success: true })).toBe(false)
    expect(uploadSucceeded(true, null)).toBe(false)
    expect(uploadFailureMessage(413, null, "")).toBe(`The file is too large. ${PHOTO_UPLOAD_LIMIT_LABEL}`)
    expect(uploadFailureMessage(400, { error: "No Drive folder." }, "")).toBe("No Drive folder.")
    expect(uploadFailureMessage(502, null, " Bad gateway ")).toBe("Upload failed (502): Bad gateway")
    expect(uploadFailureMessage(500, null, "")).toBe("Upload failed (500).")
  })

  it("summarises a partial batch", () => {
    expect(uploadBatchSummary(0, 2, ["a: x", "b: y"])).toBe("No files uploaded. 2 can be retried. a: x b: y")
    expect(uploadBatchSummary(1, 2, ["b: y"])).toBe("Uploaded 1 of 2. 1 can be retried. b: y")
  })

  it("says where weather came from", () => {
    expect(weatherFilledMessage({ source: "NWS", station: "KCOS", locationLabel: "Woodland Park" })).toBe(
      "Weather filled from NWS station KCOS near Woodland Park."
    )
    expect(weatherFilledMessage({ source: "Open-Meteo", station: null, locationLabel: null })).toBe(
      "Weather filled from Open-Meteo."
    )
  })
})
