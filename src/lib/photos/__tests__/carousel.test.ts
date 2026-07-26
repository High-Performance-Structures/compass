import { describe, expect, it } from "vitest"

import { adjacentPhoto } from "@/lib/photos/carousel"

const projectPhotos = [
  { id: "project-photo-1", projectId: "project-a" },
  { id: "project-photo-2", projectId: "project-a" },
  { id: "project-photo-3", projectId: "project-a" },
]

describe("adjacentPhoto", () => {
  it("moves forward and backward within the supplied photo scope", () => {
    expect(adjacentPhoto(projectPhotos, "project-photo-2", "next")?.id).toBe(
      "project-photo-3"
    )
    expect(
      adjacentPhoto(projectPhotos, "project-photo-2", "previous")?.id
    ).toBe("project-photo-1")
  })

  it("wraps at both ends of the carousel", () => {
    expect(adjacentPhoto(projectPhotos, "project-photo-3", "next")?.id).toBe(
      "project-photo-1"
    )
    expect(
      adjacentPhoto(projectPhotos, "project-photo-1", "previous")?.id
    ).toBe("project-photo-3")
  })

  it("does not escape the supplied project or visibility scope", () => {
    const ownerVisiblePhotos = projectPhotos.slice(0, 2)

    expect(
      adjacentPhoto(ownerVisiblePhotos, "project-photo-2", "next")?.id
    ).toBe("project-photo-1")
    expect(adjacentPhoto(ownerVisiblePhotos, "project-photo-3", "next")).toBe(
      null
    )
  })

  it("returns null for an empty scope", () => {
    expect(adjacentPhoto([], "project-photo-1", "next")).toBe(null)
  })
})
