import { describe, expect, it } from "vitest"

import {
  currentDateInputValue,
  filterAndSortPhotos,
  formatBytes,
  isInternalOnly,
  matchesVisibility,
  nextSelectedIds,
  phaseLabel,
  photoReviewCounts,
  photoSortValue,
  photoUploadError,
  photoUploadSucceeded,
  photoWithPhase,
  sourceInitial,
  sourceLabel,
  statusLabel,
  visibilityFilterValue,
  type ReviewPhoto,
} from "@/lib/photos/review"

const base: ReviewPhoto = {
  id: "p",
  fileName: "a.jpg",
  photoDate: "2026-10-01",
  schedulePhase: "",
  reviewStatus: "needs_review",
  ownerVisible: false,
  subVendorVisible: false,
  publicShareable: false,
}

const photos: readonly ReviewPhoto[] = [
  { ...base, id: "1", fileName: "b.jpg", photoDate: "2026-10-02", schedulePhase: "Framing" },
  { ...base, id: "2", fileName: "a.jpg", photoDate: "2026-10-02", schedulePhase: "Framing", ownerVisible: true, reviewStatus: "approved" },
  { ...base, id: "3", fileName: "c.jpg", photoDate: "2026-10-01", schedulePhase: "" },
  { ...base, id: "4", fileName: "d.jpg", photoDate: null, schedulePhase: "Drywall", subVendorVisible: true },
]

const noFilters = { dateFilter: "", phaseFilter: "all", visibilityFilter: "all", photoSort: "newest" } as const

describe("photo review labels", () => {
  it("labels phases, statuses, sources and sizes", () => {
    expect(phaseLabel("")).toBe("No phase")
    expect(phaseLabel("Framing")).toBe("Framing")
    expect(statusLabel("needs_review")).toBe("Needs Review")
    expect(sourceLabel("google_daily_log")).toBe("Compass")
    expect(sourceLabel("buildertrend")).toBe("Buildertrend")
    expect(sourceInitial("mobile")).toBe("A")
    expect(sourceInitial("other")).toBe("C")
    expect(formatBytes(1)).toBe("1 KB")
    expect(formatBytes(1536)).toBe("2 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB")
    expect(currentDateInputValue(new Date("2026-10-31T23:30:00.000Z"))).toBe("2026-10-31")
  })
})

describe("photo review filters", () => {
  it("parses select values", () => {
    expect(visibilityFilterValue("owner")).toBe("owner")
    expect(visibilityFilterValue("")).toBe("all")
    expect(photoSortValue("phase_oldest")).toBe("phase_oldest")
    expect(photoSortValue("x")).toBe("newest")
  })

  it("matches visibility", () => {
    expect(isInternalOnly(base)).toBe(true)
    expect(matchesVisibility(photos[1] ?? base, "owner")).toBe(true)
    expect(matchesVisibility(photos[3] ?? base, "subs_vendors")).toBe(true)
    expect(matchesVisibility(base, "public")).toBe(false)
    expect(matchesVisibility(photos[1] ?? base, "approved")).toBe(true)
    expect(matchesVisibility(base, "needs_review")).toBe(true)
  })

  it("filters by date, phase and visibility", () => {
    const ids = (filters: Parameters<typeof filterAndSortPhotos>[1]): readonly string[] =>
      filterAndSortPhotos(photos, filters).map((photo) => photo.id)
    expect(ids({ ...noFilters, dateFilter: "2026-10-02" })).toEqual(["2", "1"])
    expect(ids({ ...noFilters, phaseFilter: "unassigned" })).toEqual(["3"])
    expect(ids({ ...noFilters, phaseFilter: "Drywall" })).toEqual(["4"])
    expect(ids({ ...noFilters, visibilityFilter: "internal" })).toEqual(["1", "3"])
  })

  it("sorts by date then file name, or by phase first", () => {
    const sorted = (photoSort: "newest" | "oldest" | "phase_newest" | "phase_oldest"): readonly string[] =>
      filterAndSortPhotos(photos, { ...noFilters, photoSort }).map((photo) => photo.id)
    expect(sorted("newest")).toEqual(["2", "1", "3", "4"])
    expect(sorted("oldest")).toEqual(["3", "2", "1", "4"])
    expect(sorted("phase_newest")).toEqual(["3", "4", "2", "1"])
    expect(sorted("phase_oldest")).toEqual(["3", "4", "2", "1"])
  })

  it("counts photos", () => {
    expect(photoReviewCounts(photos)).toEqual({ total: 4, needsReview: 3, owner: 1, subVendor: 1, internal: 2 })
  })
})

describe("photo selection", () => {
  const plain = { shiftKey: false, metaKey: false, ctrlKey: false }

  it("toggles one photo on a plain or Cmd/Ctrl click", () => {
    expect(nextSelectedIds([], photos, "2", plain, null)).toEqual(["2"])
    expect(nextSelectedIds(["2"], photos, "2", plain, null)).toEqual([])
    expect(nextSelectedIds(["1"], photos, "2", { ...plain, metaKey: true }, "1")).toEqual(["1", "2"])
    expect(nextSelectedIds(["1", "2"], photos, "2", { ...plain, ctrlKey: true }, "1")).toEqual(["1"])
  })

  it("adds the range on shift-click", () => {
    expect(nextSelectedIds(["1"], photos, "4", { ...plain, shiftKey: true }, "1")).toEqual(["1", "2", "3", "4"])
    expect(nextSelectedIds(["4"], photos, "2", { ...plain, shiftKey: true }, "4")).toEqual(["4", "2", "3"])
  })

  it("falls back to a toggle when the last photo is no longer shown", () => {
    expect(nextSelectedIds([], photos, "2", { ...plain, shiftKey: true }, "gone")).toEqual(["2"])
  })
})

describe("photo updates", () => {
  it("sets the phase with its confidence and reason", () => {
    const photo = { ...base, schedulePhaseConfidence: 40, schedulePhaseReason: "Guess" }
    expect(photoWithPhase(photo, "Framing")).toMatchObject({
      schedulePhase: "Framing",
      schedulePhaseConfidence: 100,
      schedulePhaseReason: "Phase was selected during upload or review.",
    })
    expect(photoWithPhase(photo, "")).toMatchObject({
      schedulePhase: "",
      schedulePhaseConfidence: 0,
      schedulePhaseReason: "No phase assigned.",
    })
  })

  it("reads upload results", () => {
    expect(photoUploadSucceeded({ success: true })).toBe(true)
    expect(photoUploadSucceeded({ success: "true" })).toBe(false)
    expect(photoUploadSucceeded(null)).toBe(false)
    expect(photoUploadError({ error: "Drive is full." })).toBe("Drive is full.")
    expect(photoUploadError({})).toBe("Unable to upload photo.")
  })
})
