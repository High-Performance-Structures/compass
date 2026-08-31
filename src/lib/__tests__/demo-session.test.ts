import { afterEach, describe, expect, it } from "vitest"

import { isDemoSessionAllowed } from "@/lib/auth-config"

describe("demo-session isolation", () => {
  const originalE2E = process.env.COMPASS_E2E
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalE2E === undefined) {
      delete process.env.COMPASS_E2E
    } else {
      process.env.COMPASS_E2E = originalE2E
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it("rejects the synthetic demo cookie in production", () => {
    process.env.NODE_ENV = "production"
    process.env.COMPASS_E2E = "true"

    expect(isDemoSessionAllowed("true")).toBe(false)
  })

  it("rejects the synthetic demo cookie in ordinary local development", () => {
    process.env.NODE_ENV = "development"
    process.env.COMPASS_E2E = "false"

    expect(isDemoSessionAllowed("true")).toBe(false)
  })

  it("allows the synthetic demo cookie only for isolated end-to-end tests", () => {
    process.env.NODE_ENV = "test"
    process.env.COMPASS_E2E = "true"

    expect(isDemoSessionAllowed("true")).toBe(true)
    expect(isDemoSessionAllowed("false")).toBe(false)
    expect(isDemoSessionAllowed(undefined)).toBe(false)
  })
})
