import { describe, expect, it } from "vitest"

import { priorProjectGroup } from "../prior-project-access"

describe("priorProjectGroup", () => {
  it("keeps open, warranty and presale Buildertrend jobs active", () => {
    expect(priorProjectGroup("Open")).toBe("active")
    expect(priorProjectGroup("Warranty")).toBe("active")
    expect(priorProjectGroup(" presale ")).toBe("active")
  })

  it("groups closed jobs as closed and unknown status as active", () => {
    expect(priorProjectGroup("Closed")).toBe("closed")
    expect(priorProjectGroup(null)).toBe("active")
  })
})
