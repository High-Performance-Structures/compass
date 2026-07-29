import { describe, expect, it } from "vitest"

import {
  projectAudiencePhotoUrl,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"

describe("project audience photo sources", () => {
  it("builds an audience-scoped URL without exposing the Drive file ID", () => {
    const url = projectAudiencePhotoUrl(
      "proj/o-170",
      "photo 123",
      "owner"
    )

    expect(url).toBe(
      "/api/projects/proj%2Fo-170/photos/photo%20123?audience=owner"
    )
    expect(url).not.toContain("drive")
  })

  it("renders the scoped URL as a local photo source", () => {
    const scopedUrl = projectAudiencePhotoUrl(
      "proj-1",
      "photo-1",
      "sub_vendor"
    )

    expect(
      resolvePhotoImageSource({
        thumbnailUrl: scopedUrl,
        driveFileId: null,
        driveUrl: null,
      })
    ).toEqual({
      src: scopedUrl,
      reason: "ready",
      label: "Photo preview",
    })
  })
})
