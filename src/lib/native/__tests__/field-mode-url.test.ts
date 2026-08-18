import { describe, expect, it } from "vitest"

import { fieldModeUrl } from "@/lib/native/field-mode-url"

describe("fieldModeUrl", () => {
  it("returns the bundled iOS asset origin", () => {
    expect(fieldModeUrl("ios")).toBe("capacitor://localhost")
  })

  it("returns the bundled Android asset origin", () => {
    expect(fieldModeUrl("android")).toBe("https://localhost")
  })

  it("keeps browser users on the hosted field desk", () => {
    expect(fieldModeUrl("web")).toBe("/dashboard/field")
  })
})
