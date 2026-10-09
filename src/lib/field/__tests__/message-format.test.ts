import { describe, expect, it } from "vitest"

import { fieldMessageHtml, isLongFieldMessage } from "../message-format"

describe("fieldMessageHtml", () => {
  it("renders bold markers instead of showing asterisks", () => {
    expect(fieldMessageHtml("Permit **BP-26-0708** approved")).toBe("Permit <strong>BP-26-0708</strong> approved")
  })

  it("escapes HTML before adding formatting", () => {
    expect(fieldMessageHtml("**<img src=x onerror=alert(1)>**")).toBe(
      "<strong>&lt;img src=x onerror=alert(1)&gt;</strong>"
    )
  })

  it("leaves unmatched markers alone", () => {
    expect(fieldMessageHtml("5 ** 2 and a*b")).toBe("5 ** 2 and a*b")
  })
})

describe("isLongFieldMessage", () => {
  it("collapses long or many-line messages only", () => {
    expect(isLongFieldMessage("Short note")).toBe(false)
    expect(isLongFieldMessage("x".repeat(400))).toBe(true)
    expect(isLongFieldMessage("a\nb\nc\nd\ne\nf\ng")).toBe(true)
  })
})
