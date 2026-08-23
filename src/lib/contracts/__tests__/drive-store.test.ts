import { describe, expect, it } from "vitest"

import { contractTemplateDriveFileName } from "@/lib/contracts/drive-store"

describe("contract template Drive storage", () => {
  it("uses a stable versioned Markdown filename", () => {
    expect(
      contractTemplateDriveFileName({
        code: "CA00",
        name: "Cost Plus / Fixed Fee Contract",
        versionNumber: 2,
      })
    ).toBe("CA00 - Cost Plus - Fixed Fee Contract - v2.md")
  })
})
