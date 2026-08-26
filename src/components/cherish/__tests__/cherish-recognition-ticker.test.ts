import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CherishRecognitionTicker } from "@/components/cherish/cherish-recognition-ticker"

describe("CherishRecognitionTicker", () => {
  it("starts even a single anonymous recognition in the scrolling track", () => {
    const markup = renderToStaticMarkup(
      createElement(CherishRecognitionTicker, {
        items: [
          {
            id: "recognition-1",
            cherishValue: "Honor",
            responseType: "shoutout",
            message: "Thank you for helping the team.",
            isAnonymous: true,
            submittedByName: null,
            createdAt: "2026-08-25T12:00:00.000Z",
          },
        ],
      }),
    )

    expect(markup).toContain("cherish-recognition-track")
    expect(markup).toContain("Anonymous")
    expect(markup).not.toContain("Shared by")
  })
})
