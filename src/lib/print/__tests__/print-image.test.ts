import { describe, expect, it } from "vitest"

import { printImageSrc } from "../print-image"

describe("printImageSrc", () => {
  it("asks Drive photos for their print-size copy", () => {
    expect(printImageSrc("/api/google/download/abc")).toBe("/api/google/download/abc?size=print")
    expect(printImageSrc("/api/google/download/abc?projectId=p")).toBe("/api/google/download/abc?projectId=p&size=print")
  })

  it("leaves other photo sources alone", () => {
    expect(printImageSrc("/api/projects/p/photos/1")).toBe("/api/projects/p/photos/1")
  })
})
