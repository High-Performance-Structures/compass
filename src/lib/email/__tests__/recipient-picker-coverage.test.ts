import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("business email recipient picker coverage", () => {
  it("uses the shared To and Cc picker for purchase order email", () => {
    const component = source(
      "src/components/projects/project-purchase-order-email-button.tsx"
    )

    expect(component.match(/<EmailRecipientPicker/g)).toHaveLength(2)
    expect(component).toContain('label="To"')
    expect(component).toContain('label="Cc"')
    expect(component).toContain("excludedEmails={cc}")
    expect(component).toContain("excludedEmails={to}")
  })

  it("uses the same To and Cc picker for RFQ and template emails", () => {
    for (const file of [
      "src/components/projects/project-rfq-email-button.tsx",
      "src/components/email/template-email-menu.tsx",
    ]) {
      const component = source(file)
      expect(component.match(/<EmailRecipientPicker/g)).toHaveLength(2)
      expect(component).toContain('label="To"')
      expect(component).toContain('label="Cc"')
    }
  })

  it("uses the same To and Cc picker for RFI email", () => {
    const component = source(
      "src/components/projects/project-rfi-communication-actions.tsx"
    )

    expect(component.match(/<EmailRecipientPicker/g)).toHaveLength(2)
    expect(component).toContain('label="To"')
    expect(component).toContain('label="Cc"')
  })

  it("sends RFIs from Compass with the RFI's tracked reply address", () => {
    const action = source("src/app/actions/project-rfi-email.ts")

    expect(action).toContain("sendTrackedEmail({")
    expect(action).toContain('kind: "rfi"')
  })
})

describe("trade docs request recipient picker", () => {
  it("uses the shared To and Cc picker and sends a vendor-level tracked email", () => {
    const component = source("src/components/financials/trade-doc-request-panel.tsx")
    expect(component.match(/<EmailRecipientPicker/g)).toHaveLength(2)
    expect(component).toContain('label="To"')
    expect(component).toContain('label="Cc"')
    const delivery = source("src/lib/trade-docs/link-delivery.ts")
    expect(delivery).toContain("sendTrackedEmail({")
    expect(delivery).toContain('kind: "trade_docs"')
  })
})
