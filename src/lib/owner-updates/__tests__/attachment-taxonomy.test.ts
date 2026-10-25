import { describe, expect, it } from "vitest"

import { ownerUpdateAttachmentKind } from "@/lib/owner-updates/attachment-taxonomy"

describe("owner-update attachment taxonomy", () => {
  it("uses submitted selection provenance instead of mutable MIME metadata", () => {
    expect(
      ownerUpdateAttachmentKind(
        "photo-with-pdf-mime",
        new Set(["photo-with-pdf-mime"]),
        new Set()
      )
    ).toBe("photo")
    expect(
      ownerUpdateAttachmentKind(
        "document-with-image-mime",
        new Set(),
        new Set(["document-with-image-mime"])
      )
    ).toBe("document")
  })

  it("returns no taxonomy for missing or ambiguous selection provenance", () => {
    expect(ownerUpdateAttachmentKind("unselected", new Set(), new Set())).toBe(
      null
    )
    expect(
      ownerUpdateAttachmentKind(
        "selected-twice",
        new Set(["selected-twice"]),
        new Set(["selected-twice"])
      )
    ).toBe(null)
  })
})
