import { describe, expect, it } from "vitest"

import {
  MAX_PHOTO_IMAGE_RETRIES,
  nextPhotoImageRetryAttempt,
  photoImageSourceForRetry,
} from "@/lib/photos/image-retry"

describe("photo image retry policy", () => {
  it("allows only bounded retries before falling back to a placeholder", () => {
    expect(nextPhotoImageRetryAttempt(0)).toBe(1)
    expect(nextPhotoImageRetryAttempt(1)).toBe(2)
    expect(nextPhotoImageRetryAttempt(2)).toBeNull()
    expect(nextPhotoImageRetryAttempt(-1)).toBeNull()
    expect(nextPhotoImageRetryAttempt(MAX_PHOTO_IMAGE_RETRIES)).toBeNull()
  })

  it("cache-busts a local audience URL without changing its access scope", () => {
    const source = "/api/projects/project-1/photos/photo-1?audience=owner"

    expect(photoImageSourceForRetry(source, 0)).toBe(source)
    expect(photoImageSourceForRetry(source, 1)).toBe(
      `${source}&image_retry=1`
    )
  })

  it("does not expose a storage ID or replace the source on retry", () => {
    const source = "/api/projects/project-1/photos/photo-1?audience=sub_vendor"

    expect(photoImageSourceForRetry(source, 2)).toBe(
      `${source}&image_retry=2`
    )
    expect(photoImageSourceForRetry(source, 2)).not.toContain("driveFileId")
  })
})
