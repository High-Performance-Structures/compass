import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getGiftbitConfig } from "../config"

describe("Giftbit configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps testbed ordering disabled until explicitly enabled", () => {
    vi.stubEnv("GIFTBIT_ORDERING_ENABLED", "")

    const result = getGiftbitConfig({
      GIFTBIT_API_KEY: "test-key",
      GIFTBIT_ENVIRONMENT: "testbed",
    })

    expect(result).toEqual({
      success: true,
      data: {
        apiKey: "test-key",
        environment: "testbed",
        baseUrl: "https://api-testbed.giftbit.com/papi/v1",
        orderingEnabled: false,
      },
    })
  })

  it("enables ordering only when the switch is true", () => {
    const result = getGiftbitConfig({
      GIFTBIT_API_KEY: "production-key",
      GIFTBIT_ENVIRONMENT: "production",
      GIFTBIT_ORDERING_ENABLED: "true",
    })

    expect(result).toEqual({
      success: true,
      data: {
        apiKey: "production-key",
        environment: "production",
        baseUrl: "https://api.giftbit.com/papi/v1",
        orderingEnabled: true,
      },
    })
  })
})
