import { describe, expect, it } from "vitest"

import { envValue } from "@/lib/shared/env"

describe("envValue", () => {
  it("returns a configured binding exactly, without trimming", () => {
    expect(envValue({ KEY: " secret " }, "KEY")).toBe(" secret ")
    expect(envValue({ KEY: "" }, "KEY")).toBe("")
  })

  it("returns undefined for missing, non-string, or non-object env values", () => {
    expect(envValue({}, "KEY")).toBeUndefined()
    expect(envValue({ KEY: 42 }, "KEY")).toBeUndefined()
    expect(envValue(null, "KEY")).toBeUndefined()
    expect(envValue(undefined, "KEY")).toBeUndefined()
  })

  it("does not fall back to process.env", () => {
    process.env.ENV_VALUE_TEST_ONLY = "from-process"
    try {
      expect(envValue({}, "ENV_VALUE_TEST_ONLY")).toBeUndefined()
    } finally {
      delete process.env.ENV_VALUE_TEST_ONLY
    }
  })
})
