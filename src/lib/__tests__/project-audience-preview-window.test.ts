import { describe, expect, it, vi } from "vitest"

import {
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
})
