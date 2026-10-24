import { describe, expect, it } from "vitest"

import { ownerUpdateDocumentHref } from "@/components/projects/owner-update-document"

describe("owner update document links", () => {
  it("prefers the Compass audience route over provider capabilities", () => {
    expect(
      ownerUpdateDocumentHref({
        compassUrl: "/api/projects/project-1/photos/document-1?audience=owner",
        driveFileId: null,
        driveUrl: null,
      })
    ).toBe("/api/projects/project-1/photos/document-1?audience=owner")
  })

  it("keeps the internal provider fallback available when no Compass route exists", () => {
    expect(
      ownerUpdateDocumentHref({
        compassUrl: null,
        driveFileId: "drive-file-1",
        driveUrl: "https://drive.google.com/file/d/drive-file-1",
      })
    ).toBe("/api/google/download/drive-file-1")
  })
})
