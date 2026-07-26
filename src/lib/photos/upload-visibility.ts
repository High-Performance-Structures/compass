export type PhotoUploadVisibility = {
  readonly reviewStatus: "needs_review" | "approved"
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
}

export function photoUploadVisibility(
  ownerVisible: boolean,
  subVendorVisible: boolean
): PhotoUploadVisibility {
  return {
    reviewStatus:
      ownerVisible || subVendorVisible ? "approved" : "needs_review",
    ownerVisible,
    subVendorVisible,
  }
}
