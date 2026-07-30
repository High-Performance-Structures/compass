import { describe, expect, it } from "vitest"

import { shouldTrackNavigation } from "@/lib/navigation-progress"

const CURRENT = "https://compass.example.com/dashboard?view=office"

function intent(targetHref: string) {
  return {
    currentHref: CURRENT,
    targetHref,
    button: 0,
    defaultPrevented: false,
    hasModifier: false,
    target: "",
    download: false,
  }
}

describe("navigation progress", () => {
  it("tracks internal route changes", () => {
    expect(
      shouldTrackNavigation(
        intent("https://compass.example.com/dashboard/projects")
      )
    ).toBe(true)
  })

  it("tracks query changes that load a different view", () => {
    expect(
      shouldTrackNavigation(
        intent("https://compass.example.com/dashboard?view=project")
      )
    ).toBe(true)
  })

  it.each([
    ["external links", "https://example.com/dashboard"],
    ["same-page anchors", `${CURRENT}#agenda`],
    ["the current location", CURRENT],
  ])("ignores %s", (_label, href) => {
    expect(shouldTrackNavigation(intent(href))).toBe(false)
  })

  it("ignores modified and new-window navigation", () => {
    expect(
      shouldTrackNavigation({ ...intent("/dashboard/projects"), hasModifier: true })
    ).toBe(false)
    expect(
      shouldTrackNavigation({ ...intent("/dashboard/projects"), target: "_blank" })
    ).toBe(false)
  })
})
