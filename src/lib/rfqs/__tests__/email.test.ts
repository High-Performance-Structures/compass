import { describe, expect, it } from "vitest"

import { rfqEmailHtml, rfqEmailText, type RfqEmailInput } from "@/lib/rfqs/email"

const input: RfqEmailInput = {
  brand: {
    companyName: "Example Construction",
    contactLines: ["example@example.com"],
    department: "H",
    email: "example@example.com",
    logoAlt: "Example",
    logoSrc: "/logo.svg",
    mailingAddress: [],
    telephone: "555-0100",
  },
  projectLabel: "Example project",
  rfqNumber: "RFQ-123",
  title: "Framing <scope>",
  scope: "Build walls",
  requestedFrom: "Outside vendor",
  dueDate: "2026-10-09",
  message: "Please quote.",
  senderName: "Project manager",
  lines: [{ lineNumber: 1, description: "Exterior walls", phaseCode: "10", costCode: "101", notes: null }],
  documents: [{ label: "Plan set", url: "https://drive.google.com/file/d/abcdefghijk/view", notes: "Rev C" }],
}

describe("RFQ email", () => {
  it("includes RFQ scope and document links without requiring the portal", () => {
    const text = rfqEmailText(input)
    expect(text).toContain("Exterior walls")
    expect(text).toContain("Division 10")
    expect(text).toContain("https://drive.google.com/file/d/abcdefghijk/view")
    expect(text).not.toContain("/preview/projects/")
  })

  it("escapes RFQ content in HTML", () => {
    const html = rfqEmailHtml(input)
    expect(html).toContain("<th>Division</th>")
    expect(html).toContain("Framing &lt;scope&gt;")
    expect(html).toContain("Plan set")
    expect(html).toContain("href=\"https://drive.google.com/file/d/abcdefghijk/view\"")
  })
})
