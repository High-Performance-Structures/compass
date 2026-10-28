import { describe, expect, it } from "vitest"

import {
  coarseProjectDocumentAudience,
  DEFAULT_PROJECT_DOCUMENT_VISIBILITY,
  isDocumentVisibleToAudience,
  isProjectDocumentAudience,
  normalizeProjectDocumentVisibility,
  projectDocumentVisibilityLabel,
} from "@/lib/project-document-audience"

describe("project document audience", () => {
  it("defaults new files to both external audiences", () => {
    expect(DEFAULT_PROJECT_DOCUMENT_VISIBILITY).toEqual({
      owner: true,
      subVendor: true,
    })
  })

  it("recognizes the external audiences", () => {
    expect(isProjectDocumentAudience("owner")).toBe(true)
    expect(isProjectDocumentAudience("sub_vendor")).toBe(true)
    expect(isProjectDocumentAudience("project_team")).toBe(false)
  })

  it("routes each audience to its own flag", () => {
    const ownersOnly = { owner: true, subVendor: false }
    expect(isDocumentVisibleToAudience(ownersOnly, "owner")).toBe(true)
    expect(isDocumentVisibleToAudience(ownersOnly, "sub_vendor")).toBe(false)
  })

  it("derives a coarse audience that is internal-only when both flags are off", () => {
    expect(coarseProjectDocumentAudience({ owner: true, subVendor: false })).toBe(
      "project_team"
    )
    expect(coarseProjectDocumentAudience({ owner: false, subVendor: false })).toBe(
      "internal_only"
    )
  })

  it("summarizes who can see a document", () => {
    expect(
      projectDocumentVisibilityLabel({ owner: true, subVendor: true })
    ).toBe("Owners · Vendors · internal staff")
    expect(
      projectDocumentVisibilityLabel({ owner: true, subVendor: false })
    ).toBe("Owners · internal staff")
    expect(
      projectDocumentVisibilityLabel({ owner: false, subVendor: false })
    ).toBe("Internal staff only")
  })

  it("coerces arbitrary input into concrete flags", () => {
    expect(
      normalizeProjectDocumentVisibility({ owner: true, subVendor: "yes" })
    ).toEqual({ owner: true, subVendor: false })
  })
})
