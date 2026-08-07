import { describe, expect, it } from "vitest"

import { gotoAttachmentMimeType } from "@/lib/goto/mime-type"

describe("gotoAttachmentMimeType", () => {
  it("uses a specific MIME type from the download response", () => {
    expect(
      gotoAttachmentMimeType({
        declaredType: "image",
        responseType: "image/png; charset=binary",
        fileName: "attachment",
        data: new Uint8Array(),
      })
    ).toBe("image/png")
  })

  it("detects a JPEG when GoTo only declares image", () => {
    expect(
      gotoAttachmentMimeType({
        declaredType: "image",
        responseType: "application/octet-stream",
        fileName: "attachment",
        data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      })
    ).toBe("image/jpeg")
  })

  it("infers an image type from the file extension", () => {
    expect(
      gotoAttachmentMimeType({
        declaredType: "image",
        responseType: null,
        fileName: "site-photo.HEIC",
        data: new Uint8Array(),
      })
    ).toBe("image/heic")
  })

  it("detects MP4 video when GoTo only declares video", () => {
    expect(
      gotoAttachmentMimeType({
        declaredType: "video",
        responseType: "application/octet-stream",
        fileName: "attachment",
        data: new Uint8Array([
          0x00, 0x00, 0x00, 0x18,
          0x66, 0x74, 0x79, 0x70,
          0x6d, 0x70, 0x34, 0x32,
        ]),
      })
    ).toBe("video/mp4")
  })
})
