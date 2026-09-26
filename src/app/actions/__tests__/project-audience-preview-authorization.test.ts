import { describe, expect, it } from "vitest"

import { shouldIncludeOwnerUpdateHistory } from "@/lib/project-audience-preview-policy"

describe("owner update audience projection policy", () => {
  it("keeps owner update history internal-only while retaining external preview workflows", () => {
    expect(shouldIncludeOwnerUpdateHistory(true, "owner")).toBe(true)
    expect(shouldIncludeOwnerUpdateHistory(false, "owner")).toBe(false)
    expect(shouldIncludeOwnerUpdateHistory(true, "sub_vendor")).toBe(false)
    expect(shouldIncludeOwnerUpdateHistory(false, "sub_vendor")).toBe(false)
  })
})
