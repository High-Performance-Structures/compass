"use client"

import * as React from "react"
import {
  ChevronDown,
  Check,
  Search,
  Loader2,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ProviderIcon, hasLogo } from "./provider-icon"
import { useBridgeState } from "./chat-provider"
import {
  getActiveModel,
  getModelList,
  getUserModelPreference,
  setUserModelPreference,
} from "@/app/actions/ai-config"

const DEFAULT_MODEL_ID = "qwen/qwen3-coder-next"
const DEFAULT_MODEL_NAME = "Qwen3 Coder"
const DEFAULT_PROVIDER = "Alibaba (Qwen)"

// anthropic models available through the bridge
const BRIDGE_MODELS = [
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
  },
] as const

const DEFAULT_BRIDGE_MODEL = BRIDGE_MODELS[0]

// --- shared state so all instances stay in sync ---

interface SharedState {
  readonly display: {
    readonly id: string
    readonly name: string
    readonly provider: string
  }
  readonly global: {
    readonly id: string
    readonly name: string
    readonly provider: string
  }
  readonly bridgeModel: {
    readonly id: string
    readonly name: string
    readonly provider: string
  }
  readonly allowUserSelection: boolean
  readonly isAdmin: boolean
  readonly maxCostPerMillion: string | null
  readonly configLoaded: boolean
}

let shared: SharedState = {
  display: {
    id: DEFAULT_MODEL_ID,
    name: DEFAULT_MODEL_NAME,
    provider: DEFAULT_PROVIDER,
  },
  global: {
    id: DEFAULT_MODEL_ID,
    name: DEFAULT_MODEL_NAME,
    provider: DEFAULT_PROVIDER,
  },
  bridgeModel: {
    id: DEFAULT_BRIDGE_MODEL.id,
    name: DEFAULT_BRIDGE_MODEL.name,
    provider: DEFAULT_BRIDGE_MODEL.provider,
  },
  allowUserSelection: true,
  isAdmin: false,
  maxCostPerMillion: null,
  configLoaded: false,
}

const listeners = new Set<() => void>()

function getSnapshot(): SharedState {
  return shared
}

function setShared(
  next: Partial<SharedState>
): void {
  shared = { ...shared, ...next }
  for (const l of listeners) l()
}

function subscribe(
  listener: () => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

interface ModelInfo {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly contextLength: number
  readonly promptCost: string
  readonly completionCost: string
}

interface ProviderGroup {
  readonly provider: string
  readonly models: ReadonlyArray<ModelInfo>
}

function outputCostPerMillion(
  completionCost: string
): number {
  return parseFloat(completionCost) * 1_000_000
}

function formatOutputCost(
  completionCost: string
): string {
  const cost = outputCostPerMillion(completionCost)
  if (cost === 0) return "free"
  if (cost < 0.01) return "<$0.01/M"
  return `$${cost.toFixed(2)}/M`
}

export function ModelDropdown(): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const state = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  )
  const [groups, setGroups] = React.useState<
    ReadonlyArray<ProviderGroup>
  >([])
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [saving, setSaving] = React.useState<
    string | null
  >(null)
  const [listLoaded, setListLoaded] =
    React.useState(false)
  const [activeProvider, setActiveProvider] =
    React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const bridge = useBridgeState()
  const bridgeActive =
    bridge.bridgeConnected && bridge.bridgeEnabled

  React.useEffect(() => {
    if (state.configLoaded) return
    setShared({ configLoaded: true })

    // restore bridge model preference from localStorage
    const storedBridge = localStorage.getItem(
      "compass-bridge-model"
    )
    if (storedBridge) {
      const found = BRIDGE_MODELS.find(
        (m) => m.id === storedBridge
      )
      if (found) {
        setShared({
          bridgeModel: {
            id: found.id,
            name: found.name,
            provider: found.provider,
          },
        })
      }
    }

    Promise.all([
      getActiveModel(),
      getUserModelPreference(),
    ]).then(([configResult, prefResult]) => {
      let gModelId = DEFAULT_MODEL_ID
      let gModelName = DEFAULT_MODEL_NAME
      let gProvider = DEFAULT_PROVIDER
      let canSelect = true
      let ceiling: string | null = null

      let admin = false

      if (configResult.success && configResult.data) {
        gModelId = configResult.data.modelId
        gModelName = configResult.data.modelName
        gProvider = configResult.data.provider
        canSelect =
          configResult.data.allowUserSelection
        ceiling =
          configResult.data.maxCostPerMillion
        admin = configResult.data.isAdmin
      }

      const base: Partial<SharedState> = {
        global: {
          id: gModelId,
          name: gModelName,
          provider: gProvider,
        },
        allowUserSelection: canSelect,
        isAdmin: admin,
        maxCostPerMillion: ceiling,
      }

      if (
        canSelect &&
        prefResult.success &&
        prefResult.data
      ) {
        const prefValid =
          ceiling === null ||
          outputCostPerMillion(
            prefResult.data.completionCost
          ) <= parseFloat(ceiling)

        if (prefValid) {
          const slashIdx =
            prefResult.data.modelId.indexOf("/")
          setShared({
            ...base,
            display: {
              id: prefResult.data.modelId,
              name:
                slashIdx > 0
                  ? prefResult.data.modelId.slice(
                      slashIdx + 1
                    )
                  : prefResult.data.modelId,
              provider: "",
            },
          })
          return
        }
      }

      setShared({
        ...base,
        display: {
          id: gModelId,
          name: gModelName,
          provider: gProvider,
        },
      })
    })
  }, [state.configLoaded])

  React.useEffect(() => {
    if (!open || listLoaded || bridgeActive) return
    setLoading(true)
    setError(null)
    getModelList().then((result) => {
      if (result.success) {
        const sorted = [...result.data]
          .sort((a, b) => {
            const aHas = hasLogo(a.provider) ? 0 : 1
            const bHas = hasLogo(b.provider) ? 0 : 1
            if (aHas !== bHas) return aHas - bHas
            return a.provider.localeCompare(
              b.provider
            )
          })
          .map((g) => ({
            ...g,
            models: [...g.models].sort(
              (a, b) =>
                outputCostPerMillion(
                  a.completionCost
                ) -
                outputCostPerMillion(
                  b.completionCost
                )
            ),
          }))
        setGroups(sorted)
      } else {
        setError(result.error || "Failed to load models")
      }
      setListLoaded(true)
      setLoading(false)
    })
  }, [open, listLoaded, bridgeActive])

  // reset provider filter when popover closes
  React.useEffect(() => {
    if (!open) {
      setActiveProvider(null)
      setSearch("")
    }
  }, [open])

  const query = search.toLowerCase()
  const ceiling = state.maxCostPerMillion
    ? parseFloat(state.maxCostPerMillion)
    : null

  const filtered = React.useMemo(() => {
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => {
          if (ceiling !== null) {
            if (
              outputCostPerMillion(
                m.completionCost
              ) > ceiling
            )
              return false
          }
          if (
            activeProvider &&
            g.provider !== activeProvider
          ) {
            return false
          }
          if (!query) return true
          return (
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
          )
        }),
      }))
      .filter((g) => g.models.length > 0)
  }, [groups, query, ceiling, activeProvider])

  const totalFiltered = React.useMemo(() => {
    let count = 0
    for (const g of groups) {
      for (const m of g.models) {
        if (
          ceiling === null ||
          outputCostPerMillion(m.completionCost) <=
            ceiling
        ) {
          count++
        }
      }
    }
    return count
  }, [groups, ceiling])

  // sorted groups for provider sidebar (cost-filtered)
  const sortedGroups = React.useMemo(() => {
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => {
          if (ceiling === null) return true
          return (
            outputCostPerMillion(
              m.completionCost
            ) <= ceiling
          )
        }),
      }))
      .filter((g) => g.models.length > 0)
  }, [groups, ceiling])

  const handleSelect = async (
    model: ModelInfo
  ): Promise<void> => {
    if (model.id === state.display.id) {
      setOpen(false)
      return
    }
    setSaving(model.id)
    const result = await setUserModelPreference(
      model.id,
      model.promptCost,
      model.completionCost
    )
    setSaving(null)
    if (result.success) {
      setShared({
        display: {
          id: model.id,
          name: model.name,
          provider: model.provider,
        },
      })
      toast.success(`Switched to ${model.name}`)
      setOpen(false)
    } else {
      toast.error(result.error ?? "Failed to switch")
    }
  }

  const handleBridgeModelSelect = (
    model: typeof BRIDGE_MODELS[number]
  ): void => {
    setShared({
      bridgeModel: {
        id: model.id,
        name: model.name,
        provider: model.provider,
      },
    })
    localStorage.setItem(
      "compass-bridge-model",
      model.id
    )
    toast.success(`Bridge model: ${model.name}`)
    setOpen(false)
  }

  // bridge active: show bridge model selector
  if (bridgeActive) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
              "hover:bg-muted hover:text-foreground transition-colors",
              "text-emerald-600 dark:text-emerald-400",
              open && "bg-muted text-foreground"
            )}
          >
            <Zap className="h-3 w-3" />
            <span className="max-w-32 truncate">
              {state.bridgeModel.name}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-64 p-1"
        >
          <div className="px-2 py-1.5 mb-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Claude Code Bridge
            </p>
          </div>
          {BRIDGE_MODELS.map((model) => {
            const isActive =
              model.id === state.bridgeModel.id
            return (
              <button
                key={model.id}
                type="button"
                onClick={() =>
                  handleBridgeModelSelect(model)
                }
                className={cn(
                  "w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-all",
                  isActive
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-muted/70"
                )}
              >
                <ProviderIcon
                  provider="Anthropic"
                  size={20}
                  className="shrink-0"
                />
                <span className="text-xs font-medium flex-1">
                  {model.name}
                </span>
                {isActive && (
                  <Check className="h-3 w-3 text-primary shrink-0" />
                )}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
    )
  }

  if (!state.allowUserSelection && !state.isAdmin) {
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground">
        <ProviderIcon
          provider={state.global.provider}
          size={14}
        />
        <span className="max-w-28 truncate">
          {state.global.name}
        </span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            open && "bg-muted text-foreground"
          )}
        >
          <ProviderIcon
            provider={state.display.provider}
            size={14}
          />
          <span className="max-w-28 truncate">
            {state.display.name}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-96 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <TooltipProvider delayDuration={200}>
          {/* search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search models..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          {/* two-panel layout */}
          <div className="flex h-72">
            {/* provider sidebar */}
            <div className="w-11 shrink-0 overflow-y-auto flex flex-col items-center gap-0.5 py-1 border-r">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveProvider(null)
                    }
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all shrink-0",
                      activeProvider === null
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    All
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p className="text-xs">
                    All providers
                  </p>
                </TooltipContent>
              </Tooltip>
              {sortedGroups.map((group) => (
                <Tooltip key={group.provider}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveProvider(
                          activeProvider ===
                            group.provider
                            ? null
                            : group.provider
                        )
                      }
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0",
                        activeProvider ===
                          group.provider
                          ? "bg-primary/15 scale-110"
                          : "hover:bg-muted"
                      )}
                    >
                      <ProviderIcon
                        provider={group.provider}
                        size={18}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-xs">
                      {group.provider} (
                      {group.models.length})
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* model list */}
            <div className="flex-1 overflow-y-auto p-1">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-xs text-destructive px-4 text-center">
                  <p className="font-medium mb-1">Error loading models</p>
                  <p className="text-muted-foreground">{error}</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No models found.
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((group) =>
                    group.models.map((model) => {
                      const isActive =
                        model.id === state.display.id
                      const isSaving =
                        saving === model.id

                      return (
                        <button
                          key={model.id}
                          type="button"
                          disabled={
                            isSaving ||
                            saving !== null
                          }
                          onClick={() =>
                            handleSelect(model)
                          }
                          className={cn(
                            "w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-all",
                            isActive
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : "hover:bg-muted/70",
                            isSaving && "opacity-50"
                          )}
                        >
                          <ProviderIcon
                            provider={
                              model.provider
                            }
                            size={20}
                            className="shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium truncate">
                                {model.name}
                              </span>
                              {isSaving ? (
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                              ) : isActive ? (
                                <Check className="h-3 w-3 text-primary shrink-0" />
                              ) : null}
                            </div>
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1 py-0 h-3.5 mt-0.5 font-normal"
                            >
                              {formatOutputCost(
                                model.completionCost
                              )}
                            </Badge>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* budget footer */}
          {ceiling !== null && listLoaded && (
            <div className="border-t px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground">
                {totalFiltered} models within $
                {state.maxCostPerMillion}/M budget
              </p>
            </div>
          )}
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  )
}
