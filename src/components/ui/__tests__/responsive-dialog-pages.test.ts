import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ResponsiveDialogBody } from "@/components/ui/responsive-dialog"

// The invoice, bill, credit memo and payment dialogs pass their fields only as
// `pages`. On desktop (the server render here, where useIsMobile is false)
// every page must be shown, not an empty body.
describe("ResponsiveDialogBody pages on desktop", () => {
  it("shows every page one after another", () => {
    const html = renderToStaticMarkup(
      createElement(ResponsiveDialogBody, {
        pages: [createElement("p", null, "Customer"), createElement("p", null, "Line Items")],
      })
    )
    expect(html).toContain("Customer")
    expect(html).toContain("Line Items")
  })

  it("shows children when there are no pages", () => {
    const html = renderToStaticMarkup(createElement(ResponsiveDialogBody, null, createElement("p", null, "Form")))
    expect(html).toContain("Form")
  })
})
