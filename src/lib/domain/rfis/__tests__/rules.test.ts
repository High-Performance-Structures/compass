import { describe, expect, it } from "vitest"

import type { ProjectRfiItem } from "../types"
import {
  groupAttachmentsByRfi,
  isClosedRfiStatus,
  isMissingAttachmentTableError,
  requireText,
  rfiAnsweredAtAfterUpdate,
  rfiAttachmentRows,
  rfiNumberFor,
  rfiStatusAfterUpdate,
  summarizeRfis,
} from "../rules"

function item(overrides: Partial<ProjectRfiItem>): ProjectRfiItem {
  return {
    id: "rfi",
    rfiNumber: "N-1-RFI-001",
    subject: "Subject",
    question: "Question",
    answer: null,
    status: "new",
    priority: "normal",
    audience: "internal",
    requesterName: null,
    assignedToName: null,
    companyName: null,
    dueDate: null,
    submittedAt: "2026-10-01T00:00:00.000Z",
    answeredAt: null,
    attachmentCount: 0,
    attachments: [],
    assignedVendor: null,
    ...overrides,
  }
}

describe("rfiNumberFor", () => {
  it("numbers from the project number", () => {
    expect(rfiNumberFor("O-58-3674", 0, "abcdef12")).toBe("O-58-3674-RFI-001")
    expect(rfiNumberFor(" O-58-3674 ", 11, "abcdef12")).toBe("O-58-3674-RFI-012")
  })
  it("adds an id suffix without a project number", () => {
    expect(rfiNumberFor(null, 2, "abcdef12")).toBe("RFI-003-ABCDEF")
    expect(rfiNumberFor("  ", 0, "a1b2c3d4")).toBe("RFI-001-A1B2C3")
  })
})

describe("requireText", () => {
  it("trims and rejects blanks with the field label", () => {
    expect(requireText("  Hello ", "Subject")).toBe("Hello")
    expect(() => requireText("   ", "Question")).toThrow("Question is required")
  })
})

describe("RFI status rules", () => {
  it("treats closed statuses case-insensitively", () => {
    expect(isClosedRfiStatus("Complete")).toBe(true)
    expect(isClosedRfiStatus("cancelled")).toBe(true)
    expect(isClosedRfiStatus("in_progress")).toBe(false)
  })
  it("moves a new RFI to in progress when it gets a response", () => {
    expect(rfiStatusAfterUpdate(true, "new")).toBe("in_progress")
    expect(rfiStatusAfterUpdate(false, "new")).toBe("new")
    expect(rfiStatusAfterUpdate(true, "complete")).toBe("complete")
  })
  it("stamps answeredAt once", () => {
    const now = "2026-10-31T12:00:00.000Z"
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: true, status: "in_progress", existingAnsweredAt: null, now })).toBe(now)
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "complete", existingAnsweredAt: null, now })).toBe(now)
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: true, status: "complete", existingAnsweredAt: "earlier", now })).toBe("earlier")
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "new", existingAnsweredAt: null, now })).toBeNull()
  })
})

describe("summarizeRfis", () => {
  it("counts open, high priority, and audience visibility", () => {
    const items = [
      item({ id: "a", status: "new", priority: "high", audience: "sub_vendor" }),
      item({ id: "b", status: "complete", priority: "high", audience: "owner" }),
      item({ id: "c", status: "in_progress", audience: "public" }),
    ]
    const summary = summarizeRfis(items)
    expect(summary).toMatchObject({ totalCount: 3, openCount: 2, highPriorityCount: 1, subVendorVisibleCount: 2, ownerVisibleCount: 2 })
    expect(summary.nextDue?.id).toBe("a")
  })
  it("lists at most eight", () => {
    const items = Array.from({ length: 10 }, (_, index) => item({ id: String(index) }))
    expect(summarizeRfis(items).items).toHaveLength(8)
  })
})

describe("attachments", () => {
  it("builds attachment rows from the upload metadata", () => {
    let next = 0
    const rows = rfiAttachmentRows({
      projectId: "p",
      rfiId: "r",
      now: "now",
      newId: () => `id-${next++}`,
      attachments: [
        { fileName: " plan.pdf ", mimeType: "", fileSize: 10.6, storageProvider: "", storageId: "drive-1", storageUrl: null },
        { fileName: "photo.jpg", mimeType: "image/jpeg", fileSize: -3, storageProvider: "r2", storageId: null, storageUrl: " " },
      ],
    })
    expect(rows).toEqual([
      { id: "id-0", projectId: "p", rfiId: "r", fileName: "plan.pdf", mimeType: null, fileSize: 11, storageProvider: "google_drive", storageId: "drive-1", storageUrl: null, storageStatus: "uploaded", createdAt: "now", updatedAt: "now" },
      { id: "id-1", projectId: "p", rfiId: "r", fileName: "photo.jpg", mimeType: "image/jpeg", fileSize: 0, storageProvider: "r2", storageId: null, storageUrl: null, storageStatus: "pending", createdAt: "now", updatedAt: "now" },
    ])
  })
  it("groups attachments by RFI", () => {
    const base = { mimeType: null, fileSize: 1, storageUrl: null, storageStatus: "pending" }
    const grouped = groupAttachmentsByRfi([
      { ...base, id: "1", rfiId: "a", fileName: "one" },
      { ...base, id: "2", rfiId: "b", fileName: "two" },
      { ...base, id: "3", rfiId: "a", fileName: "three" },
    ])
    expect(grouped.get("a")?.map((row) => row.fileName)).toEqual(["one", "three"])
    expect(grouped.get("a")?.[0]).not.toHaveProperty("rfiId")
  })
  it("recognizes a missing attachment table", () => {
    expect(isMissingAttachmentTableError(new Error("no such table: project_rfi_attachments"))).toBe(true)
    expect(isMissingAttachmentTableError(new Error("no such table: other"))).toBe(false)
    expect(isMissingAttachmentTableError("project_rfi_attachments no such table")).toBe(false)
  })
})
