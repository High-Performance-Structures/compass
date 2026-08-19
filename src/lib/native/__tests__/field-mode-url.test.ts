import { describe, expect, it } from "vitest"

import { fieldModeUrl } from "@/lib/native/field-mode-url"

describe("fieldModeUrl", () => {
  it("returns the Field deep link for iOS", () => {
    expect(fieldModeUrl("ios")).toBe("compass://field")
  })

  it("returns the Field deep link for Android", () => {
    expect(fieldModeUrl("android")).toBe("compass://field")
  })

  it("keeps browser users on the hosted field desk", () => {
    expect(fieldModeUrl("web")).toBe("/dashboard/field")
  })
})
