import { describe, expect, it } from "vitest"

import {
  getConversationBackHref,
  getProjectConversationsHref,
  withProjectConversationContext,
} from "@/lib/conversation-navigation"

describe("project conversation navigation", () => {
  it("returns to the exact project location that opened conversations", () => {
    const returnHref =
      "/dashboard/projects/project-123/schedule?view=gantt&week=next"
    const entryHref = getProjectConversationsHref("project-123", returnHref)
    const entryUrl = new URL(entryHref, "https://compass.local")

    expect(entryUrl.pathname).toBe(
      "/dashboard/projects/project-123/conversations",
    )
    expect(entryUrl.searchParams.get("returnTo")).toBe(returnHref)
    expect(getConversationBackHref("project-123", returnHref)).toBe(
      returnHref,
    )
  })

  it("preserves project return context while switching channels", () => {
    const href = withProjectConversationContext(
      "/dashboard/conversations/channel-456",
      "project-123",
      "/dashboard/projects/project-123/photos?sort=newest",
    )
    const url = new URL(href, "https://compass.local")

    expect(url.pathname).toBe("/dashboard/conversations/channel-456")
    expect(url.searchParams.get("projectId")).toBe("project-123")
    expect(url.searchParams.get("returnTo")).toBe(
      "/dashboard/projects/project-123/photos?sort=newest",
    )
  })

  it("rejects cross-project and external return destinations", () => {
    expect(
      getConversationBackHref(
        "project-123",
        "/dashboard/projects/project-456/budget",
      ),
    ).toBe("/dashboard/projects/project-123")
    expect(
      getConversationBackHref("project-123", "https://example.com"),
    ).toBe("/dashboard/projects/project-123")
  })

  it("avoids returning to the project conversation redirect", () => {
    expect(
      getConversationBackHref(
        "project-123",
        "/dashboard/projects/project-123/conversations",
      ),
    ).toBe("/dashboard/projects/project-123")
  })

  it("keeps the global conversation fallback unchanged", () => {
    expect(getConversationBackHref(null, null)).toBe("/dashboard")
  })
})
