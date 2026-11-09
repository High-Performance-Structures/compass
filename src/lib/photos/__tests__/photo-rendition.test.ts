import { describe, expect, it } from "vitest"

import {
  PHOTO_RENDITION_LONGEST_SIDE_PX,
  photoRenditionFromSizeParam,
  photoThumbnailSrc,
  withPhotoRendition,
} from "../photo-rendition"
import { projectAudiencePhotoUrl, projectInternalPhotoUrl } from "@/lib/photo-sources"

describe("photoRenditionFromSizeParam", () => {
  it("accepts only the known sizes", () => {
    expect(photoRenditionFromSizeParam("thumb")).toBe("thumb")
    expect(photoRenditionFromSizeParam("print")).toBe("print")
    expect(photoRenditionFromSizeParam(null)).toBeNull()
    expect(photoRenditionFromSizeParam("")).toBeNull()
    expect(photoRenditionFromSizeParam("THUMB")).toBeNull()
    expect(photoRenditionFromSizeParam("original")).toBeNull()
  })

  it("keeps thumbnails smaller than print copies", () => {
    expect(PHOTO_RENDITION_LONGEST_SIDE_PX.thumb).toBe(400)
    expect(PHOTO_RENDITION_LONGEST_SIDE_PX.thumb).toBeLessThan(PHOTO_RENDITION_LONGEST_SIDE_PX.print)
  })
})

describe("photoThumbnailSrc", () => {
  it("asks the internal and audience photo routes for a thumbnail", () => {
    expect(photoThumbnailSrc(projectInternalPhotoUrl("proj 1", "photo-1"))).toBe(
      "/api/projects/proj%201/photos/photo-1?size=thumb"
    )
    expect(photoThumbnailSrc(projectAudiencePhotoUrl("p", "1", "owner"))).toBe(
      "/api/projects/p/photos/1?audience=owner&size=thumb"
    )
  })

  it("asks the Drive download route for a thumbnail", () => {
    expect(photoThumbnailSrc("/api/google/download/abc")).toBe("/api/google/download/abc?size=thumb")
  })

  it("replaces an existing size instead of adding a second one", () => {
    expect(withPhotoRendition("/api/projects/p/photos/1?size=print", "thumb")).toBe(
      "/api/projects/p/photos/1?size=thumb"
    )
  })

  it("leaves URLs the photo routes do not serve alone", () => {
    expect(photoThumbnailSrc("https://example.com/photo.jpg")).toBe("https://example.com/photo.jpg")
    expect(photoThumbnailSrc("/owner-update-photos/photo.jpg")).toBe("/owner-update-photos/photo.jpg")
    expect(photoThumbnailSrc("/api/projects/p/photos/1/metadata")).toBe("/api/projects/p/photos/1/metadata")
  })
})
