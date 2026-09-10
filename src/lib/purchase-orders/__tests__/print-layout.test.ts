import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("purchase order print layout", () => {
  it("uses a repeating table header while item rows continue", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )
    const styles = source("src/app/globals.css")

    expect(page).toContain(
      '<thead data-purchase-order-items-header="true">'
    )
    expect(page).toContain('className="purchase-order-items')
    expect(styles).toContain(".purchase-order-items thead")
    expect(styles).toContain("display: table-header-group")
    expect(styles).toContain(".purchase-order-items tfoot")
    expect(styles).toContain("display: table-row-group")
  })

  it("provides a vendor signature line in the printable approval area", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )

    expect(page).toContain("Vendor Signature")
    expect(page).toContain('className="mt-10 grid grid-cols-4')
  })
})
