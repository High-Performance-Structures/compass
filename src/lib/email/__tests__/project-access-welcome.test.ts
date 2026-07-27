import { describe, expect, it } from "vitest"

import {
  buildProjectAccessWelcomeHtml,
  projectAccessWelcomeTemplate,
} from "@/lib/email/project-access-welcome"

describe("project access welcome email", () => {
  it("builds an editable project-specific message", () => {
    const result = projectAccessWelcomeTemplate({
      recipientName: "Alex Owner",
      projectLabel: "O-202 - Loeffler",
    })

    expect(result.subject).toContain("O-202 - Loeffler")
    expect(result.message).toContain("Hi Alex Owner")
    expect(result.message).toContain("outside your approved project access")
  })

  it("escapes message and link content in HTML", () => {
    const html = buildProjectAccessWelcomeHtml({
      message: "Hi <Owner>\n\nUse Compass:",
      actionUrl: 'https://example.com/?value="unsafe"',
      actionLabel: "Open <Compass>",
      projectLabel: "Project & Home",
    })

    expect(html).toContain("Hi &lt;Owner&gt;")
    expect(html).toContain("Project &amp; Home")
    expect(html).toContain("Open &lt;Compass&gt;")
    expect(html).not.toContain('href="https://example.com/?value="unsafe""')
  })
})
