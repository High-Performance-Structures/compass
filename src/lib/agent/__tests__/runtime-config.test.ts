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

  it("prefers the shared OpenAI key over older shared keys when no row exists", () => {
    const result = resolveRuntimeProvider(null, {
      OPENAI_API_KEY: "shared-openai-key",
      OPENROUTER_API_KEY: "stale-openrouter-key",
    })

    expect(result).toEqual({
      success: true,
      providerType: "openai",
      provider: { type: "openai", apiKey: "shared-openai-key" },
    })
  })

  it("passes OPENAI_REASONING_EFFORT to OpenAI providers only", () => {
    const shared = resolveRuntimeProvider(null, {
      OPENAI_API_KEY: "shared-openai-key",
      OPENAI_REASONING_EFFORT: " none ",
    })
    const stored = resolveRuntimeProvider(
      { type: "openai", apiKey: null, baseUrl: null, modelOverrides: null },
      { OPENAI_API_KEY: "k", OPENAI_REASONING_EFFORT: "none" }
    )
    const openrouter = resolveRuntimeProvider(
      { type: "openrouter", apiKey: "k", baseUrl: null, modelOverrides: null },
      { OPENAI_REASONING_EFFORT: "none" }
    )

    expect(shared.success && shared.provider.reasoningEffort).toBe("none")
    expect(stored.success && stored.provider.reasoningEffort).toBe("none")
    expect(openrouter.success && openrouter.provider.reasoningEffort).toBeUndefined()
  })

  it("uses the shared OpenAI secret for a stored OpenAI provider without a key", () => {
    const result = resolveRuntimeProvider(
      { type: "openai", apiKey: null, baseUrl: null, modelOverrides: null },
      { OPENAI_API_KEY: "shared-openai-key" }
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.provider).toMatchObject({ type: "openai", apiKey: "shared-openai-key" })
    }
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

describe("resolveRuntimeModelId for OpenAI", () => {
  it("uses OPENAI_MODEL over the admin model setting", () => {
    expect(resolveRuntimeModelId("deepseek/deepseek-chat-v3.1", "openai", "gpt-test")).toBe("gpt-test")
  })

  it("reduces an OpenRouter openai/ ID to its native name", () => {
    expect(resolveRuntimeModelId("openai/gpt-test", "openai")).toBe("gpt-test")
  })

  it("leaves other providers unaffected by OPENAI_MODEL", () => {
    expect(resolveRuntimeModelId("deepseek/deepseek-chat-v3.1", "openrouter", "gpt-test")).toBe(
      "deepseek/deepseek-chat-v3.1"
    )
  })
})
