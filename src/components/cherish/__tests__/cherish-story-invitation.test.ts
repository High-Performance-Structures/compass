import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CherishStoryInvitation } from "@/components/cherish/cherish-story-invitation"

describe("CherishStoryInvitation", () => {
  it("invites the user into an unread story without exposing its message", () => {
    const markup = renderToStaticMarkup(
      createElement(CherishStoryInvitation, {
        items: [
          {
            id: "recognition-1",
            cherishValue: "Honor",
            responseType: "shoutout",
            message: "Thank you for helping the team.",
            isAnonymous: true,
            submittedByName: null,
            publishedAt: "2026-08-29T12:00:00.000Z",
            viewedAt: null,
            reactedAt: null,
            reactionCount: 0,
            audience: { scope: "company" },
          },
        ],
      }),
    )

    expect(markup).toContain("New CHERISH story")
    expect(markup).toContain("Watch")
    expect(markup).not.toContain("Thank you for helping the team.")
    expect(markup).not.toContain("marquee")
  })

  it("does not render when no story was published in the active window", () => {
    const markup = renderToStaticMarkup(
      createElement(CherishStoryInvitation, { items: [] }),
    )

    expect(markup).toBe("")
  })
})
