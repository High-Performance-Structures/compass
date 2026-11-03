import { describe, expect, it } from "vitest"

import { printImageSrc } from "../print-image"

describe("printImageSrc", () => {
  it("asks Drive photos for their print-size copy", () => {
    expect(printImageSrc("/api/google/download/abc")).toBe("/api/google/download/abc?size=print")
    expect(printImageSrc("/api/google/download/abc?projectId=p")).toBe("/api/google/download/abc?projectId=p&size=print")
  })

  it("sizes project-scoped photos while retaining audience and preview scope", () => {
    expect(printImageSrc("/api/projects/p/photos/1")).toBe("/api/projects/p/photos/1?size=print")
    expect(printImageSrc("/api/projects/p/photos/1?audience=owner&previewAs=viewer")).toBe("/api/projects/p/photos/1?audience=owner&previewAs=viewer&size=print")
    expect(printImageSrc("/api/projects/p/photos/1?size=print")).toBe("/api/projects/p/photos/1?size=print")
  })

  it("leaves other sources and photo collection routes alone", () => {
    expect(printImageSrc("https://example.com/photo.jpg")).toBe("https://example.com/photo.jpg")
    expect(printImageSrc("/owner-update-photos/photo.jpg")).toBe("/owner-update-photos/photo.jpg")
    expect(printImageSrc("/api/projects/p/photos/upload")).toBe("/api/projects/p/photos/upload?size=print")
    expect(printImageSrc("/api/projects/p/photos/1/metadata")).toBe("/api/projects/p/photos/1/metadata")
  })
})
