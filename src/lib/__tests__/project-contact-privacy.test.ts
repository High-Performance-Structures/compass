import { describe, expect, it } from "vitest"

import { projectContactAddress } from "@/lib/project-contact-privacy"

describe("projectContactAddress", () => {
  it("hides internal employee addresses even when a legacy project row has one", () => {
    expect(projectContactAddress("internal", "123 Home Street")).toBeNull()
  })

  it("preserves non-employee company addresses", () => {
    expect(projectContactAddress("owner", "456 Client Street")).toBe(
      "456 Client Street"
    )
    expect(projectContactAddress("supplier", null)).toBeNull()
  })
})
