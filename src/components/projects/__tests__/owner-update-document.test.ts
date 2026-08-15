import { describe, expect, it } from "vitest"

import { ownerUpdateDocumentHref } from "@/lib/owner-updates/resource-links"

describe("Owner Update document links", () => {
  it("uses the protected project photo route for external viewers", () => {
    expect(
      ownerUpdateDocumentHref({
        projectId: "project-1",
        photoId: "photo-1",
        viewerIsInternal: false,
        driveFileId: "drive-1",
        driveUrl: "https://drive.google.com/file/d/secret/view",
      })
    ).toBe("/api/projects/project-1/photos/photo-1?audience=owner")
  })
})
