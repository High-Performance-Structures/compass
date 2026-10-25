import { describe, expect, it } from "vitest"

import { feedbackMessageParts } from "@/lib/jarvis/feedback-message-links"

describe("feedbackMessageParts", () => {
  it("links a help guide path and leaves sentence punctuation as text", () => {
    expect(feedbackMessageParts("See /dashboard/help/daily-logs#create-log.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "/dashboard/help/daily-logs#create-log", href: "/dashboard/help/daily-logs#create-log", external: false },
      { kind: "text", text: "." },
    ])
  })

  it("links web addresses as external", () => {
    expect(feedbackMessageParts("Details: https://example.com/a?b=1, thanks")).toEqual([
      { kind: "text", text: "Details: " },
      { kind: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1", external: true },
      { kind: "text", text: ", thanks" },
    ])
  })

  it("keeps plain messages as one text part", () => {
    expect(feedbackMessageParts("Your request has been received.")).toEqual([
      { kind: "text", text: "Your request has been received." },
    ])
  })

  it("does not treat a path inside another word as a link", () => {
    expect(feedbackMessageParts("abc/dashboard/help")).toEqual([
      { kind: "text", text: "abc/dashboard/help" },
    ])
  })

  it("links a path in parentheses", () => {
    expect(feedbackMessageParts("(guide: /dashboard/help/owner-updates)")).toEqual([
      { kind: "text", text: "(guide: " },
      { kind: "link", text: "/dashboard/help/owner-updates", href: "/dashboard/help/owner-updates", external: false },
      { kind: "text", text: ")" },
    ])
  })
})
