import { describe, expect, it } from "vitest"

import {
  renderFieldTabIcon,
  type FieldTabIcon,
} from "./tab-icons"

const ICONS: readonly FieldTabIcon[] = [
  "projects",
  "today",
  "log",
  "documents",
  "chat",
  "cherish",
]

describe("Field Mode tab icons", () => {
  it.each(ICONS)("renders an accessible decorative %s icon", (icon) => {
    const markup = renderFieldTabIcon(icon)

    expect(markup).toContain('class="tab-icon"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain("currentColor")
  })
})
