import { describe, expect, it, vi } from "vitest"

import {
  closeProjectAudiencePreviewWindow,
  openProjectAudiencePreviewWindow,
  PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME,
} from "@/lib/project-audience-preview-window"

describe("project audience preview windows", () => {
  it("opens previews in the reusable managed Compass window", () => {
    const focus = vi.fn()
    const opener = vi.fn(() => ({ focus }))

    expect(openProjectAudiencePreviewWindow("/preview/example", opener)).toBe(
      true
    )
    expect(opener).toHaveBeenCalledWith(
      "/preview/example",
      PROJECT_AUDIENCE_PREVIEW_WINDOW_NAME,
      expect.stringContaining("popup=yes")
    )
    expect(focus).toHaveBeenCalledOnce()
  })

  it("keeps native anchor navigation available when popups are blocked", () => {
    expect(
      openProjectAudiencePreviewWindow("/preview/example", () => null)
    ).toBe(false)
  })

  it("closes a managed preview window without navigating it", () => {
    const replace = vi.fn()
    const previewWindow = {
      closed: false,
      close: vi.fn(() => {
        previewWindow.closed = true
      }),
      location: { replace },
    }
    const schedule = vi.fn((callback: () => void) => callback())

    closeProjectAudiencePreviewWindow(
      "/dashboard/projects/project-1",
      previewWindow,
      schedule
    )

    expect(previewWindow.close).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(replace).not.toHaveBeenCalled()
  })

  it("leaves preview mode when the browser refuses to close the tab", () => {
    const replace = vi.fn()
    const previewWindow = {
      closed: false,
      close: vi.fn(),
      location: { replace },
    }
    const schedule = vi.fn((callback: () => void) => callback())

    closeProjectAudiencePreviewWindow(
      "/dashboard/projects/project-1",
      previewWindow,
      schedule
    )

    expect(replace).toHaveBeenCalledWith("/dashboard/projects/project-1")
  })
})
