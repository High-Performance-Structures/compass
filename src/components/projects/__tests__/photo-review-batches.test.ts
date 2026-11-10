/** @vitest-environment jsdom */

import * as React from "react"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectPhotoLibrary, ProjectPhotoLibraryItem } from "@/app/actions/project-photos"
import type { PhotoReviewCard } from "@/components/projects/photo-review/photo-review-card"
import type { PhotoReviewToolbar } from "@/components/projects/photo-review/photo-review-toolbar"
import type { PhotoDrawer } from "@/components/projects/photo-review/photo-drawer"
import { ProjectPhotoReview } from "@/components/projects/project-photo-review"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/project-photos", () => ({
  updateProjectPhotoPhase: vi.fn(),
  updateProjectPhotoPermissions: vi.fn(),
  deleteProjectPhotos: vi.fn(),
}))
vi.mock("@/components/developer-mode-provider", () => ({
  useDeveloperMode: () => ({ developerModeEnabled: false }),
}))
vi.mock("@/components/projects/project-context-switcher", () => ({ ProjectContextSwitcher: () => null }))
vi.mock("@/components/help/contextual-help-beacon", () => ({ ContextualHelpBeacon: () => null }))
vi.mock("@/components/projects/photo-review/photo-upload-sheet", () => ({ PhotoUploadSheet: () => null }))
vi.mock("@/components/projects/photo-review/photo-review-card", () => ({
  PhotoReviewCard: ({ photo, onOpenPreview, onToggle }: React.ComponentProps<typeof PhotoReviewCard>) =>
    createElement("article", { "data-photo-id": photo.id },
      createElement("button", { type: "button", onClick: onOpenPreview }, `Open ${photo.id}`),
      createElement("button", { type: "button", onClick: onToggle }, `Select ${photo.id}`)),
}))
vi.mock("@/components/projects/photo-review/photo-review-toolbar", () => ({
  PhotoReviewToolbar: ({ filters, selectedCount, filteredCount, onSelectFiltered }: React.ComponentProps<typeof PhotoReviewToolbar>) =>
    createElement("div", null,
      createElement("output", { "data-testid": "selection" }, `${selectedCount} selected of ${filteredCount}`),
      createElement("button", { type: "button", onClick: onSelectFiltered }, "Select filtered"),
      createElement("button", { type: "button", onClick: () => filters.setDateFilter("2023-01-01") }, "Filter historical date"),
      createElement("button", { type: "button", onClick: () => filters.setDateFilter("") }, "All dates"),
      createElement("button", { type: "button", onClick: () => filters.setPhotoSort("oldest") }, "Oldest first")),
}))
vi.mock("@/components/projects/photo-review/photo-drawer", () => ({
  PhotoDrawer: ({ previewPhoto, filteredPhotos, onShowAdjacent, onClose }: React.ComponentProps<typeof PhotoDrawer>) =>
    previewPhoto ? createElement("div", { role: "dialog" },
      createElement("output", null, `${previewPhoto.id} of ${filteredPhotos.length}`),
      createElement("button", { type: "button", onClick: () => onShowAdjacent("next") }, "Next photo"),
      createElement("button", { type: "button", onClick: onClose }, "Close preview")) : null,
}))

function photo(index: number): ProjectPhotoLibraryItem {
  return {
    id: `photo-${String(index).padStart(3, "0")}`,
    projectId: "project-1", dailyLogId: null, sourceSystem: "buildertrend",
    fileName: `${String(index).padStart(3, "0")}.jpg`, mimeType: "image/jpeg",
    driveFileId: null, driveUrl: null, thumbnailUrl: null, caption: null,
    capturedAt: null, logDate: null, photoDate: index === 230 ? "2023-01-01" : "2024-01-01",
    reviewStatus: "needs_review", ownerVisible: false, subVendorVisible: false,
    publicShareable: false, photoKind: "progress", schedulePhase: "",
    schedulePhaseConfidence: 0, schedulePhaseReason: "No phase assigned.",
  }
}

const library: ProjectPhotoLibrary = {
  project: { id: "project-1", name: "Large archive", projectNumber: "P-001" },
  photos: Array.from({ length: 255 }, (_, index) => photo(index)),
  phases: [],
}

describe("staff photo card batches", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(createElement(ProjectPhotoReview, { library })))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function click(text: string): Promise<void> {
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text)
    if (!button) throw new Error(`Missing button: ${text}`)
    await act(async () => button.click())
  }

  it("reaches every unique photo through the final partial batch", async () => {
    expect(host.querySelectorAll("article")).toHaveLength(100)
    await click("Show 100 more photos")
    expect(host.querySelectorAll("article")).toHaveLength(200)
    await click("Show 55 more photos")
    const ids = Array.from(host.querySelectorAll("article")).map((item) => item.getAttribute("data-photo-id"))
    expect(ids).toHaveLength(255)
    expect(new Set(ids)).toEqual(new Set(library.photos.map((item) => item.id)))
    expect(host.textContent).toContain("Showing 255 of 255 photos")
    expect(host.textContent).not.toContain("more photos")
  })

  it("filters and sorts photos beyond the rendered cards and resets the card window", async () => {
    expect(host.querySelector('[data-photo-id="photo-230"]')).toBeNull()
    await click("Filter historical date")
    expect(host.querySelectorAll("article")).toHaveLength(1)
    expect(host.querySelector("article")?.getAttribute("data-photo-id")).toBe("photo-230")
    await click("All dates")
    await click("Show 100 more photos")
    expect(host.querySelectorAll("article")).toHaveLength(200)
    await click("Oldest first")
    expect(host.querySelectorAll("article")).toHaveLength(100)
    expect(host.querySelector("article")?.getAttribute("data-photo-id")).toBe("photo-230")
  })

  it("selects all filtered photos and advances the viewer beyond the rendered batch", async () => {
    await click("Select filtered")
    expect(host.querySelector('[data-testid="selection"]')?.textContent).toBe("255 selected of 255")
    await click("Open photo-099")
    await click("Next photo")
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("photo-100 of 255")
    expect(host.querySelector('[data-photo-id="photo-100"]')).toBeNull()
    expect(host.querySelectorAll("article")).toHaveLength(100)
  })
})
