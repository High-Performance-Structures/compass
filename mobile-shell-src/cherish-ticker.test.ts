import { describe, expect, it } from "vitest"

import type { FieldCherishRecognition } from "../src/lib/field/types"
import { renderCherishTicker } from "./cherish-ticker"

const escapeHtml = (value: string): string => value.replace(
  /[&<>'"]/g,
  (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character,
)

function recognition(
  id: string,
  message: string,
  submittedByName: string | null,
  isAnonymous = false,
): FieldCherishRecognition {
  return {
    id,
    cherishValue: "Honor",
    responseType: "shoutout",
    message,
    isAnonymous,
    submittedByName,
    createdAt: "2026-08-28T12:00:00.000Z",
  }
}

describe("renderCherishTicker", () => {
  it("renders every recognition in the scrolling track", () => {
    const markup = renderCherishTicker([
      recognition("one", "First message", "Isabel"),
      recognition("two", "Second message", "Martine"),
    ], escapeHtml)

    expect(markup).toContain("cherish-ticker-track")
    expect(markup).toContain("First message")
    expect(markup).toContain("Second message")
    expect(markup).toContain("— Isabel")
    expect(markup).toContain("— Martine")
  })

  it("escapes recognition content and preserves anonymous attribution", () => {
    const markup = renderCherishTicker([
      recognition("one", "Honor <everyone>", "Ignored", true),
    ], escapeHtml)

    expect(markup).toContain("Honor &lt;everyone&gt;")
    expect(markup).toContain("— Anonymous")
    expect(markup).not.toContain("Ignored")
  })

  it("does not render an empty ticker", () => {
    expect(renderCherishTicker([], escapeHtml)).toBe("")
  })
})
