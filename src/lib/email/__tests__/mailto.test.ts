import { describe, expect, it } from "vitest"

import { trackedMailtoHref } from "@/lib/email/mailto"

describe("trackedMailtoHref", () => {
  it("opens the default mail app with a Compass tracking address in CC", () => {
    const href = trackedMailtoHref({
      to: ["owner@example.com"],
      cc: "Compass <jarvis+cmp-token@hps-colorado.com>",
      subject: "[RFI-4] Roof framing",
      body: "Please reply all.",
    })

    expect(href).toContain("mailto:owner%40example.com")
    expect(href).toContain("cc=jarvis%2Bcmp-token%40hps-colorado.com")
    expect(href).toContain("subject=%5BRFI-4%5D+Roof+framing")
  })
})
