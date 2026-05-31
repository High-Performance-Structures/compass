"use client"

import * as React from "react"
import { ChevronDown, Check } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ============================================================================
// Inline Claude sparkle — rendered directly here to avoid stale HMR
// from provider-icon.tsx. This is the ONLY icon the model dropdown needs.
// ============================================================================

function ClaudeSparkle({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2a.9.9 0 0 1 .84.58l2.32 5.94a4.5 4.5 0 0 0 2.6 2.6l5.94 2.32a.9.9 0 0 1 0 1.67l-5.94 2.32a4.5 4.5 0 0 0-2.6 2.6l-2.32 5.94a.9.9 0 0 1-1.68 0l-2.32-5.94a4.5 4.5 0 0 0-2.6-2.6L.3 15.11a.9.9 0 0 1 0-1.67l5.94-2.32a4.5 4.5 0 0 0 2.6-2.6L11.16 2.58A.9.9 0 0 1 12 2Z"
        fill="#D97757"
      />
    </svg>
  )
}

// ============================================================================
// Types
// ============================================================================

const PROVIDER_TYPES = [
  "anthropic-oauth",
  "anthropic-key",
  "openrouter",
  "ollama",
  "custom",
] as const

type ProviderType = (typeof PROVIDER_TYPES)[number]

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
// Provider display helpers
// ============================================================================

function providerUsesModelPicker(type: ProviderType): boolean {
  return (
    type === "anthropic-oauth" ||
    type === "anthropic-key" ||
    type === "openrouter"
  )
}

// ============================================================================
// External store (shared across components)
// ============================================================================

const STORAGE_KEY = "compass-agent-model"
const PROVIDER_STORAGE_KEY = "compass-agent-provider"

function loadState(): ProviderState {
  if (typeof window === "undefined") {
    return defaultState()
  }

  try {
    const raw = localStorage.getItem(PROVIDER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const providerType = (
        PROVIDER_TYPES.includes(parsed.providerType as ProviderType)
          ? parsed.providerType
          : "anthropic-oauth"
      ) as ProviderType

      const modelObj = parsed.model as
        | { id?: string }
        | undefined
      const model =
        AGENT_MODELS.find((m) => m.id === modelObj?.id) ??
        AGENT_MODELS[0]

      return {
        providerType,
        model,
        customModelId:
          typeof parsed.customModelId === "string"
            ? parsed.customModelId
            : "",
      }
    }
  } catch {
    // fall through
  }

  // legacy: migrate from old model-only storage
  const legacyModel = localStorage.getItem(STORAGE_KEY)
  if (legacyModel) {
    const model =
      AGENT_MODELS.find((m) => m.id === legacyModel) ??
      AGENT_MODELS[0]
    return { ...defaultState(), model }
  }

  return defaultState()
}

function defaultState(): ProviderState {
  return DEFAULT_PROVIDER_STATE
}

let state: ProviderState = DEFAULT_PROVIDER_STATE
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ProviderState {
  return state
}

function getServerSnapshot(): ProviderState {
  return DEFAULT_PROVIDER_STATE
}

function emit(): void {
  for (const l of listeners) l()
}

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
  emit()
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

/** Returns the provider type for context */
export function getAgentProviderType(): ProviderType {
  return state.providerType
}

// ============================================================================
// Component
// ============================================================================

export function ModelDropdown(): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const current = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )

  // restore from localStorage on mount
  React.useEffect(() => {
    const stored = loadState()
    if (
      stored.providerType !== state.providerType ||
      stored.model.id !== state.model.id
    ) {
      state = stored
      emit()
    }
  }, [])

  // hydrate provider type from D1 on mount
  React.useEffect(() => {
    import("@/app/actions/provider-config")
      .then(({ getUserProviderConfig }) => {
        getUserProviderConfig()
          .then((result) => {
            if (!("success" in result) || !result.success)
              return
            if (!result.data) return

            const d = result.data
            const providerType = (
              PROVIDER_TYPES.includes(
                d.providerType as ProviderType
              )
                ? d.providerType
                : state.providerType
            ) as ProviderType

            if (providerType !== state.providerType) {
              updateState({ providerType })
            }
          })
          .catch(() => {})
      })
      .catch(() => {})
  }, [])

  const usesModelPicker = providerUsesModelPicker(
    current.providerType
  )

  const displayName = usesModelPicker
    ? current.model.name
    : current.customModelId || "Custom"

  const handleModelSelect = (m: AgentModel): void => {
    updateState({ model: m })
    setOpen(false)
  }

  const handleCustomModelChange = (v: string): void => {
    updateState({ customModelId: v })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
            "hover:bg-muted hover:text-foreground transition-colors",
            "text-muted-foreground",
            open && "bg-muted text-foreground"
          )}
        >
          <ClaudeSparkle size={14} />
          <span className="max-w-36 truncate">
            {displayName}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-56 p-1"
      >
        {usesModelPicker ? (
          <div role="radiogroup" aria-label="Model">
            {AGENT_MODELS.map((m) => {
              const isActive = m.id === current.model.id
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => handleModelSelect(m)}
                  className={cn(
                    "w-full text-left rounded-md px-2.5 py-2 flex items-center gap-2.5 transition-all",
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-muted/70"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">
                      {m.name}
                    </span>
                    <p className="text-[10px] text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                  {isActive && (
                    <Check className="h-3 w-3 text-primary shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="p-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
              Model ID
            </label>
            <Input
              type="text"
              value={current.customModelId}
              onChange={(e) =>
                handleCustomModelChange(e.target.value)
              }
              placeholder="llama3.2"
              className="h-7 text-xs"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
