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

  it("uses the same To and Cc picker for RFI email", () => {
    const component = source(
      "src/components/projects/project-rfi-communication-actions.tsx"
    )

    expect(component.match(/<EmailRecipientPicker/g)).toHaveLength(2)
    expect(component).toContain('label="To"')
    expect(component).toContain('label="Cc"')
  })

  it("keeps the Compass reply address alongside selected RFI copies", () => {
    const action = source("src/app/actions/project-rfis.ts")

    expect(action).toContain("cc: [...cc, thread.replyToAddress]")
  })
})
