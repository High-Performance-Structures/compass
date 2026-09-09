import { describe, expect, it } from "vitest"

import { greetingCardActionFailure } from "@/lib/greeting-cards/session-error"

describe("greeting-card action failures", () => {
  it.each([
    "Session has expired.",
    "Unauthorized",
    "Failed to refresh session: invalid_grant",
  ])("offers reauthentication for %s", (message) => {
    expect(greetingCardActionFailure(new Error(message))).toEqual({
      message:
        "Your Compass session expired. Sign in again, then return to this card and submit it.",
      sessionExpired: true,
    })
  })

  it("recognizes a wrapped cross-realm-style error", () => {
    expect(
      greetingCardActionFailure({
        message: "Server action failed",
        cause: { message: "Could not authorize the request." },
      }),
    ).toEqual({
      message:
        "Your Compass session expired. Sign in again, then return to this card and submit it.",
      sessionExpired: true,
    })
  })

  it("preserves a non-session failure message", () => {
    expect(greetingCardActionFailure("Choose an available e-card design.")).toEqual({
      message: "Choose an available e-card design.",
      sessionExpired: false,
    })
  })

  it("does not offer Compass reauthentication for a labeled provider error", () => {
    const message =
      "Handwrytten connection expired. An administrator needs to update the Handwrytten API key before mailed cards can be prepared."
    expect(greetingCardActionFailure(message)).toEqual({
      message,
      sessionExpired: false,
    })
  })

  it("uses a safe fallback for an unknown rejection", () => {
    expect(greetingCardActionFailure({ code: "UNKNOWN" })).toEqual({
      message: "Unable to submit the greeting-card request.",
      sessionExpired: false,
    })
  })
})
