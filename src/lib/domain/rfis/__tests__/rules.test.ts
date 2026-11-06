import { describe, expect, it } from "vitest"

import { defaultRecordStatusList, resolveRecordStatuses } from "@/lib/domain/record-statuses/rules"

import type { ProjectRfiItem } from "../types"

const RFI_STATUSES = defaultRecordStatusList("rfi")
// A company that added "With engineer" (Open) and "Answered by owner" (Closed), and counts Info needed as Closed.
const COMPANY = resolveRecordStatuses("rfi", [
  { statusKey: "with_engineer", label: "With engineer", color: "blue", statusGroup: "open", sortOrder: 5, showAsButton: true, hidden: false, builtIn: false },
  { statusKey: "answered_by_owner", label: "Answered by owner", color: "green", statusGroup: "closed", sortOrder: 6, showAsButton: true, hidden: false, builtIn: false },
  { statusKey: "info_needed", label: "Info needed", color: "orange", statusGroup: "closed", sortOrder: 2, showAsButton: true, hidden: false, builtIn: true },
])
import {
  groupAttachmentsByRfi,
  isMissingAttachmentTableError,
  requireText,
  rfiAnsweredAtAfterUpdate,
  rfiAttachmentRows,
  rfiNumberFor,
  rfiStatusAfterInboundReply,
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
  it("moves only a New RFI to in progress on an emailed reply, leaving company and unknown statuses alone", () => {
    expect(rfiStatusAfterInboundReply(RFI_STATUSES, "new")).toBe("in_progress")
    expect(rfiStatusAfterInboundReply(RFI_STATUSES, "Open")).toBe("in_progress")
    expect(rfiStatusAfterInboundReply(COMPANY, "with_engineer")).toBeNull()
    expect(rfiStatusAfterInboundReply(RFI_STATUSES, "something_else")).toBeNull()
    expect(rfiStatusAfterInboundReply(RFI_STATUSES, "complete")).toBeNull()
  })
  it("moves a new RFI to in progress when it gets a response", () => {
    expect(rfiStatusAfterUpdate(true, "new")).toBe("in_progress")
    expect(rfiStatusAfterUpdate(false, "new")).toBe("new")
    expect(rfiStatusAfterUpdate(true, "complete")).toBe("complete")
  })
  it("stamps answeredAt once", () => {
    const now = "2026-10-31T12:00:00.000Z"
    const statuses = RFI_STATUSES
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: true, status: "in_progress", statuses, existingAnsweredAt: null, now })).toBe(now)
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "complete", statuses, existingAnsweredAt: null, now })).toBe(now)
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: true, status: "complete", statuses, existingAnsweredAt: "earlier", now })).toBe("earlier")
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "new", statuses, existingAnsweredAt: null, now })).toBeNull()
    // Any status the company counts as Closed stamps it; Void does not.
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "answered_by_owner", statuses: COMPANY, existingAnsweredAt: null, now })).toBe(now)
    expect(rfiAnsweredAtAfterUpdate({ hasResponse: false, status: "void", statuses, existingAnsweredAt: null, now })).toBeNull()
  })
})

describe("summarizeRfis", () => {
  it("counts open, high priority, and audience visibility", () => {
    const items = [
      item({ id: "a", status: "new", priority: "high", audience: "sub_vendor" }),
      item({ id: "b", status: "complete", priority: "high", audience: "owner" }),
      item({ id: "c", status: "in_progress", audience: "public" }),
    ]
    const summary = summarizeRfis(items, RFI_STATUSES)
    expect(summary).toMatchObject({ totalCount: 3, openCount: 2, highPriorityCount: 1, subVendorVisibleCount: 2, ownerVisibleCount: 2 })
    expect(summary.nextDue?.id).toBe("a")
  })
  it("counts open by the company's groups", () => {
    const items = [
      item({ id: "a", status: "info_needed" }),
      item({ id: "b", status: "with_engineer" }),
      item({ id: "c", status: "answered_by_owner" }),
    ]
    expect(summarizeRfis(items, COMPANY).openCount).toBe(1)
  })
  it("lists at most eight", () => {
    const items = Array.from({ length: 10 }, (_, index) => item({ id: String(index) }))
    expect(summarizeRfis(items, RFI_STATUSES).items).toHaveLength(8)
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
