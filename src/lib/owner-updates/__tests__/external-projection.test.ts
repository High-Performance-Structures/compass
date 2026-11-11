import { describe, expect, it } from "vitest"

import {
  ownerUpdateExternalDocument,
  ownerUpdateExternalListItem,
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
        "/api/projects/project-1/photos/document-1?audience=owner&resourceType=owner_update_document",
      caption: null,
      capturedAt: "2026-10-20",
      sourceSystem: "Compass",
    })
    expect(JSON.stringify(result)).not.toContain("drive.google.com")
    expect(JSON.stringify(result)).not.toContain("drive-bearer-id")
  })
})

describe("owner update text", () => {
  const summary = [
    "Good evening Tanis and Travis,",
    "We will let you know soon about your Certificate of Occupancy and the installation dates.",
    "Video: https://youtu.be/dQw4w9WgXcQ and file https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view",
    "Loose id dQw4w9WgXcQ in a sentence.",
    "It's been wonderful working with you!",
  ].join("\n")
  const update = ownerUpdateExternalListItem({
    id: "update-1", title: "Update", updateDate: "2026-09-18", status: "published", channel: "portal", summary,
    publishedAt: "2026-09-19T01:33:00Z", sentAt: null, createdAt: "", updatedAt: "",
  })

  it("keeps every ordinary paragraph, including 11-letter words", () => {
    expect(update.summary).toContain("Certificate of Occupancy and the installation dates.")
    expect(update.summary).toContain("It's been wonderful working with you!")
  })

  it("removes only the links and ids, keeping the rest of the line", () => {
    expect(update.summary).not.toMatch(/youtu|drive\.google|dQw4w9WgXcQ|1AbCdEf/)
    expect(update.summary).toContain("Video: and file")
    expect(update.summary).toContain("Loose id in a sentence.")
  })

  it("keeps an ordinary file name with a long word", () => {
    const photo = ownerUpdateExternalPhoto("project-1", {
      id: "photo-2", sourceSystem: "compass", fileName: "Certificate of Occupancy.pdf", mimeType: "application/pdf",
      driveFileId: null, driveUrl: null, thumbnailUrl: null, caption: null, capturedAt: null, reviewStatus: "approved", ownerVisible: true,
    })
    expect(photo.fileName).toBe("Certificate of Occupancy.pdf")
  })
})
