import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/projects/project-brand-logo", () => ({ ProjectBrandLogo: () => null }))
vi.mock("@/components/projects/project-brand-contact-details", () => ({ ProjectBrandContactDetails: () => null }))

import type { ProjectDailyLogItem } from "@/app/actions/project-field"
import { DailyLogPrintDocument } from "@/components/projects/daily-log-print-document"

const photo = {
  id: "photo-1",
  fileName: "footing.jpg",
  mimeType: "image/jpeg",
  driveFileId: "drive-1",
  driveUrl: null,
  thumbnailUrl: null,
  caption: "Footing pour",
  capturedAt: null,
  reviewStatus: "approved",
  ownerVisible: false,
  subVendorVisible: false,
  publicShareable: false,
}

describe("DailyLogPrintDocument", () => {
  it("prints each log's photos as thumbnails", () => {
    const log: ProjectDailyLogItem = {
      id: "log-1",
      sourceSystem: "compass",
      sourceExternalId: null,
      weatherTempF: null,
      weatherConditions: null,
      weatherPrecipitation: null,
      isClientVisible: false,
      reviewStatus: "approved",
      syncStatus: "synced",
      scheduleItems: [],
      todos: [],
      workLines: [],
      logDate: "2026-10-16",
      authorName: "Field lead",
      weather: null,
      hoursWorked: null,
      crewPresent: null,
      materialsUsed: null,
      workCompleted: "Poured footings",
      issues: null,
      safetyIncidents: null,
      visitorLog: null,
      notes: null,
      photos: [photo, { ...photo, id: "photo-2", driveFileId: null, caption: "No source" }],
    }
    const markup = renderToStaticMarkup(
      createElement(DailyLogPrintDocument, {
        clientName: null,
        logs: [log],
        projectId: "project-1",
        projectLabel: "H-100",
        projectName: "Example",
        projectNumber: "H-100",
      })
    )
    expect(markup).toContain('src="/api/google/download/drive-1?size=print"')
    expect(markup).toContain("Footing pour")
    expect(markup).toContain("Photo not available")
  })
})
