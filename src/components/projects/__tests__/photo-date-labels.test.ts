import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { ProjectPhotoLibraryItem } from "@/app/actions/project-photos"
import { ProjectPhotoReview } from "@/components/projects/project-photo-review"
import { ProjectAudiencePhotoGallery } from "@/components/projects/project-audience-photo-gallery"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/project-photos", () => ({
  updateProjectPhotoPhase: vi.fn(),
  updateProjectPhotoPermissions: vi.fn(),
}))
vi.mock("@/components/developer-mode-provider", () => ({
  useDeveloperMode: () => ({ developerModeEnabled: false }),
}))
vi.mock("@/components/projects/project-context-switcher", () => ({
  ProjectContextSwitcher: () => null,
}))
vi.mock("@/components/help/contextual-help-beacon", () => ({
  ContextualHelpBeacon: () => null,
}))

const undatedPhoto: ProjectPhotoLibraryItem = {
  id: "undated-photo",
  projectId: "project-1",
  dailyLogId: null,
  sourceSystem: "buildertrend",
  fileName: "historical-photo.jpg",
  mimeType: "image/jpeg",
  driveFileId: null,
  driveUrl: null,
  thumbnailUrl: "/api/projects/project-1/photos/undated-photo",
  caption: null,
  capturedAt: null,
  logDate: null,
  photoDate: null,
  reviewStatus: "needs_review",
  ownerVisible: false,
  subVendorVisible: false,
  publicShareable: false,
  photoKind: "progress",
  schedulePhase: "",
  schedulePhaseConfidence: 0,
  schedulePhaseReason: "No phase assigned.",
}

describe("photo gallery date labels", () => {
  it("shows unknown capture dates in the staff gallery alongside known dates", () => {
    const knownPhoto = {
      ...undatedPhoto,
      id: "known-photo",
      fileName: "recorded-photo.jpg",
      capturedAt: "2025-11-21T18:03:16.000Z",
      photoDate: "2025-11-21",
    }
    const markup = renderToStaticMarkup(React.createElement(ProjectPhotoReview, {
      library: {
        project: { id: "project-1", name: "Example project", projectNumber: "P-001" },
        photos: [undatedPhoto, knownPhoto],
        phases: [],
      },
    }))
    expect(markup).toContain("Capture date unknown")
    expect(markup).toContain("2025-11-21")
    expect(markup).toContain("historical-photo.jpg")
  })

  it("keeps an all-undated audience gallery visible without inventing a date", () => {
    const markup = renderToStaticMarkup(React.createElement(ProjectAudiencePhotoGallery, {
      photos: [undatedPhoto],
      title: "Project photos",
      emptyMessage: "No photos shared yet.",
    }))
    expect(markup).toContain("historical-photo.jpg")
    expect(markup).toContain("Capture date unknown")
    expect(markup).not.toContain("No photos shared yet.")
  })
})
