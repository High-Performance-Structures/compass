import { describe, expect, it, vi } from "vitest"

import {
  openHpsProjectManagerWorkWindow,
  resolveHpsProjectManagerWebAppUrl,
} from "@/lib/google/project-manager-app"

describe("HPS Project Manager app", () => {
  it("uses the configured web app URL when present", () => {
    expect(resolveHpsProjectManagerWebAppUrl(" https://example.com/manager ")).toBe(
      "https://example.com/manager"
    )
  })

  it("falls back to the deployed HPS web app URL", () => {
    expect(resolveHpsProjectManagerWebAppUrl(" ")).toContain(
      "script.google.com/a/macros/hps-colorado.com/"
    )
  })

  it("focuses the Project Manager popup", () => {
    const focus = vi.fn()
    const assign = vi.fn()
    const open = vi.fn(() => ({ focus }))

    openHpsProjectManagerWorkWindow({ location: { assign }, open }, "https://example.com")

    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "hps-project-manager",
      expect.stringContaining("scrollbars=yes")
    )
    expect(focus).toHaveBeenCalledOnce()
    expect(assign).not.toHaveBeenCalled()
  })

  it("navigates directly when the popup is blocked", () => {
    const assign = vi.fn()
    const open = vi.fn(() => null)

    openHpsProjectManagerWorkWindow({ location: { assign }, open }, "https://example.com")

    expect(assign).toHaveBeenCalledWith("https://example.com")
  })
})
