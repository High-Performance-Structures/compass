"use client"

type ProviderType =
  | "anthropic-oauth"
  | "anthropic-key"
  | "openrouter"
  | "ollama"
  | "custom"

const AGENT_MODELS = [
  {
    id: "sonnet",
    modelId: "claude-sonnet-4-20250514",
    name: "Sonnet",
    description: "Fast and capable",
  },
  {
    id: "opus",
    modelId: "claude-opus-4-20250514",
    name: "Opus",
    description: "Most intelligent",
  },
  {
    id: "haiku",
    modelId: "claude-3-5-haiku-20241022",
    name: "Haiku",
    description: "Quick and lightweight",
  },
] as const

type AgentModel = (typeof AGENT_MODELS)[number]

interface ProviderState {
  providerType: ProviderType
  model: AgentModel
  customModelId: string
}

const DEFAULT_PROVIDER_STATE: ProviderState = {
  providerType: "anthropic-oauth",
  model: AGENT_MODELS[0],
  customModelId: "",
}

// ============================================================================
// Shared state (persisted for the agent session)
// ============================================================================

const STORAGE_KEY = "compass-agent-model"
const PROVIDER_STORAGE_KEY = "compass-agent-provider"

let state: ProviderState = DEFAULT_PROVIDER_STATE
function persistState(): void {
  try {
    localStorage.setItem(
      PROVIDER_STORAGE_KEY,
      JSON.stringify(state)
    )
    localStorage.setItem(STORAGE_KEY, state.model.id)
  } catch {
    // storage full or unavailable
  }
}

function updateState(patch: Partial<ProviderState>): void {
  state = { ...state, ...patch }
  persistState()
}

/**
 * Update provider type from settings page.
 * Called by ai-model-tab when the user changes provider.
 */
export function setProviderType(type: ProviderType): void {
  updateState({ providerType: type })
}

// ============================================================================
// Public API for use-agent.ts
// ============================================================================

/** Returns the model ID to send to the agent server */
export function getAgentModelId(): string {
  const { providerType, model, customModelId } = state

  // Ollama and custom providers use the user-entered model ID
  if (providerType === "ollama" || providerType === "custom") {
    return customModelId || model.id
  }

  // OpenRouter uses the anthropic/ prefix
  if (providerType === "openrouter") {
    // Map full model IDs to OpenRouter format
    const openRouterMap: Record<string, string> = {
      "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
      "claude-opus-4-20250514": "anthropic/claude-opus-4",
      "claude-3-5-haiku-20241022": "anthropic/claude-3.5-haiku",
    }
    return openRouterMap[model.modelId] ?? `anthropic/${model.id}`
  }

  // Anthropic OAuth and API key use full model IDs
  return model.modelId
}
