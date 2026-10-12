import { describe, expect, it } from "vitest"
import {
  browserHandoffUrl,
  safeBrowserDestination,
} from "@/lib/native/browser-handoff"

describe("safeBrowserDestination", () => {
  it("keeps same-origin Compass paths", () => {
    expect(safeBrowserDestination("/dashboard/projects/abc?tab=schedule#today"))
      .toBe("/dashboard/projects/abc?tab=schedule#today")
  })

  it("falls back to the dashboard for missing or off-site destinations", () => {
    expect(safeBrowserDestination(null)).toBe("/dashboard")
    expect(safeBrowserDestination("")).toBe("/dashboard")
    expect(safeBrowserDestination("https://evil.example/dashboard")).toBe("/dashboard")
    expect(safeBrowserDestination("//evil.example/dashboard")).toBe("/dashboard")
    expect(safeBrowserDestination("/\\evil.example")).toBe("/dashboard")
    expect(safeBrowserDestination("dashboard")).toBe("/dashboard")
  })
})

describe("browserHandoffUrl", () => {
  it("routes through /open so the app does not reclaim the link", () => {
    const url = new URL(browserHandoffUrl("https://compass.example", "/dashboard/projects/abc"))
    expect(url.pathname).toBe("/open")
    expect(url.searchParams.get("to")).toBe("/dashboard/projects/abc")
  })
})
