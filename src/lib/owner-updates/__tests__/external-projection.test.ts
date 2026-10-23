import { describe, expect, it } from "vitest"

import {
  ownerUpdateExternalDocument,
  ownerUpdateExternalPhoto,
} from "@/lib/owner-updates/external-projection"

describe("owner update external projection", () => {
  it("preserves Compass UUID identifiers while rejecting provider-shaped IDs", () => {
    const uuid = ownerUpdateExternalPhoto(
      "project-1",
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        sourceSystem: "Compass",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        driveFileId: null,
        driveUrl: null,
        thumbnailUrl: null,
        caption: null,
        capturedAt: null,
        reviewStatus: "approved",
        ownerVisible: true,
      }
    )
    const providerId = ownerUpdateExternalPhoto("project-1", {
      ...{
        id: "dQw4w9WgXcQ",
        sourceSystem: "Compass",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        driveFileId: null,
        driveUrl: null,
        thumbnailUrl: null,
        caption: null,
        capturedAt: null,
        reviewStatus: "approved",
        ownerVisible: true,
      },
    })

    expect(uuid.id).toBe("123e4567-e89b-12d3-a456-426614174000")
    expect(providerId.id).toBe("")
  })

  it("returns a closed photo DTO when every stored string is hostile", () => {
    const result = ownerUpdateExternalPhoto("project-1", {
      id: "photo-1",
      sourceSystem: "https://drive.google.com/file/d/drive-bearer-id/view",
      fileName: "See drive-bearer-id-12345678901234567890",
      mimeType: "https://drive.google.com/mime",
      driveFileId: "drive-bearer-id-12345678901234567890",
      driveUrl: "https://drive.google.com/file/d/drive-bearer-id/view",
      thumbnailUrl: "https://drive.google.com/thumbnail",
      caption: "Safe caption\nhttps://drive.google.com/file/d/drive-bearer-id/view",
      capturedAt: "https://drive.google.com/captured",
      reviewStatus: "https://drive.google.com/review",
      ownerVisible: true,
    })

    expect(result).toEqual({
      id: "photo-1",
      sourceSystem: "Compass",
      fileName: "Project photo",
      mimeType: null,
      driveFileId: null,
      driveUrl: null,
      thumbnailUrl: "/api/projects/project-1/photos/photo-1?audience=owner",
      caption: "Safe caption",
      capturedAt: null,
      reviewStatus: "approved",
      ownerVisible: true,
    })
    expect(JSON.stringify(result)).not.toContain("drive.google.com")
    expect(JSON.stringify(result)).not.toContain("drive-bearer-id")
  })

  it("returns a closed document DTO without snapshot provider capabilities", () => {
    const result = ownerUpdateExternalDocument("project-1", {
      id: "document-1",
      fileName: "https://drive.google.com/file/d/drive-bearer-id/view",
      mimeType: "application/pdf",
      driveFileId: "drive-bearer-id-12345678901234567890",
      driveUrl: "https://drive.google.com/file/d/drive-bearer-id/view",
      caption: "https://drive.google.com/caption",
      capturedAt: "2026-10-20T12:00:00.000Z",
      sourceSystem: "https://drive.google.com/source",
    })

    expect(result).toEqual({
      id: "document-1",
      fileName: "Project document",
      mimeType: "application/pdf",
      driveFileId: null,
      driveUrl: null,
      compassUrl:
        "/api/projects/project-1/photos/document-1?audience=owner",
      caption: null,
      capturedAt: "2026-10-20",
      sourceSystem: "Compass",
    })
    expect(JSON.stringify(result)).not.toContain("drive.google.com")
    expect(JSON.stringify(result)).not.toContain("drive-bearer-id")
  })
})
