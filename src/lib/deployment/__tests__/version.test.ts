import { describe, expect, it } from "vitest"

import { hasDeploymentChanged } from "@/lib/deployment/version"

describe("deployment version", () => {
  it("detects a newer deployment without treating empty values as versions", () => {
    expect(hasDeploymentChanged("build-a", "build-b")).toBe(true)
    expect(hasDeploymentChanged("build-a", "build-a")).toBe(false)
    expect(hasDeploymentChanged("", "build-b")).toBe(false)
    expect(hasDeploymentChanged("build-a", "")).toBe(false)
  })
})
