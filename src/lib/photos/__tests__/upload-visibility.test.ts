import { describe, expect, it } from "vitest"

import { photoUploadVisibility } from "@/lib/photos/upload-visibility"

describe("photoUploadVisibility", () => {
  it("keeps staff-only uploads in review", () => {
    expect(photoUploadVisibility(false, false)).toEqual({
      reviewStatus: "needs_review",
      ownerVisible: false,
      subVendorVisible: false,
    })
  })

  it("approves owner-visible uploads", () => {
    expect(photoUploadVisibility(true, false)).toEqual({
      reviewStatus: "approved",
      ownerVisible: true,
      subVendorVisible: false,
    })
  })

  it("approves subcontractor-visible uploads", () => {
    expect(photoUploadVisibility(false, true)).toEqual({
      reviewStatus: "approved",
      ownerVisible: false,
      subVendorVisible: true,
    })
  })

  it("supports visibility for both audiences", () => {
    expect(photoUploadVisibility(true, true)).toEqual({
      reviewStatus: "approved",
      ownerVisible: true,
      subVendorVisible: true,
    })
  })
})
