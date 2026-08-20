import { describe, expect, it } from "vitest"

import { trackedMailtoHref } from "@/lib/email/mailto"

describe("trackedMailtoHref", () => {
  it("opens the default mail app with a Compass tracking address in CC", () => {
    const href = trackedMailtoHref({
      to: ["owner@example.com"],
      cc: ["Compass <jarvis+cmp-token@hps-colorado.com>"],
      subject: "[RFI-4] Roof framing",
      body: "Please reply all.",
    })

    expect(href).toContain("mailto:owner%40example.com")
    expect(href).toContain("cc=jarvis%2Bcmp-token%40hps-colorado.com")
    expect(href).toContain("subject=%5BRFI-4%5D%20Roof%20framing")
    expect(href).not.toContain("+")
  })

  it("percent-encodes spaces and line breaks for default mail apps", () => {
    const href = trackedMailtoHref({
      to: ["owner@example.com"],
      cc: ["jarvis@example.com"],
      subject: "RFI follow up",
      body: "First line\n\nSecond line",
    })

    expect(href).toContain("subject=RFI%20follow%20up")
    expect(href).toContain("body=First%20line%0A%0ASecond%20line")
    expect(href).not.toContain("+")
  })

  it("includes selected contacts and Compass tracking in CC", () => {
    const href = trackedMailtoHref({
      to: ["vendor@example.com"],
      cc: [
        "client@example.com",
        "Compass <jarvis+cmp-token@hps-colorado.com>",
      ],
      subject: "RFI follow up",
      body: "Please reply all.",
    })

    expect(href).toContain(
      "cc=client%40example.com%2Cjarvis%2Bcmp-token%40hps-colorado.com"
    )
  })
})
