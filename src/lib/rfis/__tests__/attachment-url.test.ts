import { describe, expect, it } from "vitest"

import { viewableRfiAttachmentUrl } from "@/lib/rfis/attachment-url"

describe("viewableRfiAttachmentUrl", () => {
  it("rejects Buildertrend provenance URLs", () => {
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "https://buildertrend.net/app/RFIs/RFI/748715/33312757",
        storageStatus: "uploaded",
      })
    ).toBeNull()
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "https://cdn.buildertrend.net/file.pdf",
        storageStatus: "uploaded",
      })
    ).toBeNull()
  })

  it("allows Drive and Compass URLs", () => {
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "https://drive.google.com/file/d/example/view",
        storageStatus: "uploaded",
      })
    ).toBe("https://drive.google.com/file/d/example/view")
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "/api/google/download/example",
        storageStatus: "uploaded",
      })
    ).toBe("/api/google/download/example")
  })

  it("rejects empty, held, and malformed URLs", () => {
    expect(
      viewableRfiAttachmentUrl({ storageUrl: " ", storageStatus: "uploaded" })
    ).toBeNull()
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "https://drive.google.com/file/d/example/view",
        storageStatus: "source_reference_unavailable",
      })
    ).toBeNull()
    expect(
      viewableRfiAttachmentUrl({
        storageUrl: "javascript:alert(1)",
        storageStatus: "uploaded",
      })
    ).toBeNull()
  })
})
