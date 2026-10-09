import type { ProviderConfig } from "agent-core"

export interface StoredProviderConfig {
  readonly type: string
  readonly apiKey: string | null
  readonly baseUrl: string | null
  readonly modelOverrides: Readonly<Record<string, string>> | null
}

export interface AgentRuntimeSecrets {
  readonly ANTHROPIC_API_KEY?: string
  readonly OPENROUTER_API_KEY?: string
  readonly OPENAI_API_KEY?: string
}

export type RuntimeProviderResult =
  | {
      readonly success: true
      readonly provider: ProviderConfig
      readonly providerType: string
    }
  | {
      readonly success: false
      readonly error: string
    }

function requiresApiKey(type: ProviderConfig["type"]): boolean {
  return type !== "ollama"
}

export function mapRuntimeProviderType(
  type: string
): ProviderConfig["type"] {
  switch (type) {
    case "anthropic-key":
    case "anthropic-oauth":
    case "anthropic":
      return "anthropic"
    case "openrouter":
      return "openrouter"
    case "ollama":
      return "ollama"
    case "openai":
      return "openai"
    default:
      return "custom"
  }
}

function sharedApiKey(
  type: ProviderConfig["type"],
  secrets: AgentRuntimeSecrets
): string | undefined {
  if (type === "openrouter") {
    return secrets.OPENROUTER_API_KEY
  }
  if (type === "anthropic") {
    return secrets.ANTHROPIC_API_KEY
  }
  if (type === "openai") {
    return secrets.OPENAI_API_KEY
  }
  return undefined
}

/**
 * Builds the runtime provider without exposing deployment secrets to the
 * browser. A stored provider may intentionally omit its own key and use the
 * organization's shared Worker secret.
 */
export function resolveRuntimeProvider(
  stored: StoredProviderConfig | null,
  secrets: AgentRuntimeSecrets
): RuntimeProviderResult {
  if (!stored) {
    // OpenAI is checked first so a configured OpenAI key wins over an older
    // shared OpenRouter or Anthropic key left in the deployment.
    if (secrets.OPENAI_API_KEY) {
      return {
        success: true,
        providerType: "openai",
        provider: {
          type: "openai",
          apiKey: secrets.OPENAI_API_KEY,
        },
      }
    }

    if (secrets.OPENROUTER_API_KEY) {
      return {
        success: true,
        providerType: "openrouter",
        provider: {
          type: "openrouter",
          apiKey: secrets.OPENROUTER_API_KEY,
        },
      }
    }

    if (secrets.ANTHROPIC_API_KEY) {
      return {
        success: true,
        providerType: "anthropic",
        provider: {
          type: "anthropic",
          apiKey: secrets.ANTHROPIC_API_KEY,
        },
      }
    }

    return {
      success: false,
      error:
        "No shared AI provider is configured. An administrator must configure OPENAI_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY.",
    }
  }

  const type = mapRuntimeProviderType(stored.type)
  const apiKey =
    stored.apiKey ?? sharedApiKey(type, secrets)

  if (requiresApiKey(type) && !apiKey) {
    const secretName =
      type === "openrouter"
        ? "OPENROUTER_API_KEY"
        : type === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : type === "openai"
            ? "OPENAI_API_KEY"
            : "an API key"
    return {
      success: false,
      error: `The ${stored.type} provider is selected but ${secretName} is not configured.`,
    }
  }

  return {
    success: true,
    providerType: stored.type,
    provider: {
      type,
      apiKey,
      baseUrl: stored.baseUrl ?? undefined,
      modelOverrides:
        stored.modelOverrides ?? undefined,
    },
  }
}

/**
 * Resolves legacy short model names for providers that still use them.
 * Full OpenRouter and Anthropic model IDs pass through unchanged.
 */
export function resolveRuntimeModelId(
  model: string,
  providerType: string,
  openaiModel?: string
): string {
  // The admin model setting usually holds an OpenRouter ID, which OpenAI
  // rejects. OPENAI_MODEL picks the OpenAI model; otherwise an "openai/..."
  // OpenRouter ID is reduced to its native name.
  if (providerType === "openai") {
    if (openaiModel && openaiModel.trim().length > 0) {
      return openaiModel.trim()
    }
    return model.startsWith("openai/") ? model.slice("openai/".length) : model
  }

  if (model.includes("/") || model.startsWith("claude-")) {
    return model
  }

  const anthropicModels: Readonly<Record<string, string>> = {
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-opus-4-20250514",
    haiku: "claude-3-5-haiku-20241022",
  }

  const openrouterModels: Readonly<Record<string, string>> = {
    sonnet: "anthropic/claude-sonnet-4",
    opus: "anthropic/claude-opus-4",
    haiku: "anthropic/claude-3.5-haiku",
  }

  if (
    providerType === "anthropic" ||
    providerType === "anthropic-oauth" ||
    providerType === "anthropic-key"
  ) {
    return anthropicModels[model] ?? model
  }

  if (providerType === "openrouter") {
    return openrouterModels[model] ?? model
  }

  return model
}

export function selectRuntimeModel(
  configuredModel: string | null | undefined,
  requestedModel: string | null | undefined
): string {
  return configuredModel ?? requestedModel ?? "sonnet"
}
