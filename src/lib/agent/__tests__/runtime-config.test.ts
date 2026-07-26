import { describe, expect, it } from "vitest"
import {
  resolveRuntimeModelId,
  resolveRuntimeProvider,
  selectRuntimeModel,
} from "@/lib/agent/runtime-config"

describe("resolveRuntimeProvider", () => {
  it("uses the shared OpenRouter secret when a stored provider has no key", () => {
    const result = resolveRuntimeProvider(
      {
        type: "openrouter",
        apiKey: null,
        baseUrl: "https://openrouter.ai/api",
        modelOverrides: null,
      },
      { OPENROUTER_API_KEY: "shared-openrouter-key" }
    )

    expect(result).toEqual({
      success: true,
      providerType: "openrouter",
      provider: {
        type: "openrouter",
        apiKey: "shared-openrouter-key",
        baseUrl: "https://openrouter.ai/api",
        modelOverrides: undefined,
      },
    })
  })

  it("prefers a stored key over the shared deployment secret", () => {
    const result = resolveRuntimeProvider(
      {
        type: "openrouter",
        apiKey: "stored-key",
        baseUrl: null,
        modelOverrides: null,
      },
      { OPENROUTER_API_KEY: "shared-key" }
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.provider.apiKey).toBe("stored-key")
    }
  })

  it("defaults to the shared OpenRouter provider when no row exists", () => {
    const result = resolveRuntimeProvider(null, {
      OPENROUTER_API_KEY: "shared-openrouter-key",
    })

    expect(result).toEqual({
      success: true,
      providerType: "openrouter",
      provider: {
        type: "openrouter",
        apiKey: "shared-openrouter-key",
      },
    })
  })

  it("returns a useful configuration error instead of an unauthenticated client", () => {
    const result = resolveRuntimeProvider(
      {
        type: "openrouter",
        apiKey: null,
        baseUrl: null,
        modelOverrides: null,
      },
      {}
    )

    expect(result).toEqual({
      success: false,
      error:
        "The openrouter provider is selected but OPENROUTER_API_KEY is not configured.",
    })
  })
})

describe("resolveRuntimeModelId", () => {
  it("preserves the globally configured OpenRouter model ID", () => {
    expect(
      resolveRuntimeModelId(
        "deepseek/deepseek-chat-v3.1",
        "openrouter"
      )
    ).toBe("deepseek/deepseek-chat-v3.1")
  })

  it("keeps compatibility with legacy short model names", () => {
    expect(
      resolveRuntimeModelId("sonnet", "openrouter")
    ).toBe("anthropic/claude-sonnet-4")
  })
})

describe("selectRuntimeModel", () => {
  it("makes the server-side active model authoritative", () => {
    expect(
      selectRuntimeModel(
        "deepseek/deepseek-chat-v3.1",
        "anthropic/claude-opus-4"
      )
    ).toBe("deepseek/deepseek-chat-v3.1")
  })

  it("uses a request model only for legacy deployments without agent config", () => {
    expect(
      selectRuntimeModel(null, "anthropic/claude-sonnet-4")
    ).toBe("anthropic/claude-sonnet-4")
  })
})
