import { describe, expect, it } from "vitest"

import {
  driveFileIdFromValue,
  isProjectDocumentCategory,
  isPublishedProjectDocumentStatus,
} from "@/lib/project-documents"

describe("project documents", () => {
  it("recognizes supported construction-document categories", () => {
    expect(isProjectDocumentCategory("architectural_plans")).toBe(true)
    expect(isProjectDocumentCategory("internal_pricing")).toBe(false)
  })

  it("extracts Google Drive file IDs from supported values", () => {
    expect(
      driveFileIdFromValue("https://drive.google.com/file/d/file-123/view")
    ).toBe("file-123")
    expect(driveFileIdFromValue("https://drive.google.com/open?id=file-456")).toBe(
      "file-456"
    )
    expect(driveFileIdFromValue("file-789")).toBe("file-789")
  })

  it("limits external reads to current and superseded publications", () => {
    expect(isPublishedProjectDocumentStatus("current")).toBe(true)
    expect(isPublishedProjectDocumentStatus("superseded")).toBe(true)
    expect(isPublishedProjectDocumentStatus("draft")).toBe(false)
    expect(isPublishedProjectDocumentStatus("archived")).toBe(false)
  })
})
