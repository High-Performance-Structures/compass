"use client"

import * as React from "react"
import {
  Check,
  Loader2,
  Search,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  getActiveModel,
  setActiveModel,
  getModelList,
  getUsageMetrics,
  updateModelPolicy,
} from "@/app/actions/ai-config"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  ProviderIcon,
  hasLogo,
} from "@/components/agent/provider-icon"

const DEFAULT_MODEL_ID = "qwen/qwen3-coder-next"

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

interface ActiveConfig {
  readonly modelId: string
  readonly modelName: string
  readonly provider: string
  readonly promptCost: string
  readonly completionCost: string
  readonly contextLength: number
  readonly maxCostPerMillion: string | null
  readonly allowUserSelection: boolean
  readonly isAdmin: boolean
}

interface UsageMetrics {
  readonly totalRequests: number
  readonly totalTokens: number
  readonly totalCost: string
  readonly dailyBreakdown: ReadonlyArray<{
    date: string
    tokens: number
    cost: string
    requests: number
  }>
  readonly modelBreakdown: ReadonlyArray<{
    modelId: string
    tokens: number
    cost: string
    requests: number
  }>
}

function formatCost(costPerToken: string): string {
  const perMillion =
    parseFloat(costPerToken) * 1_000_000
  if (perMillion === 0) return "free"
  if (perMillion < 0.01) return "<$0.01/M"
  return `$${perMillion.toFixed(2)}/M`
}

function formatOutputCost(
  completionCost: string
): string {
  const cost =
    parseFloat(completionCost) * 1_000_000
  if (cost === 0) return "free"
  if (cost < 0.01) return "<$0.01/M"
  return `$${cost.toFixed(2)}/M`
}

function formatContext(length: number): string {
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(0)}M`
  }
  return `${(length / 1000).toFixed(0)}k`
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return String(tokens)
}

function outputCostPerMillion(
  completionCost: string
): number {
  return parseFloat(completionCost) * 1_000_000
}

// --- two-panel model picker ---

function ModelPicker({
  groups,
  activeConfig,
  onSaved,
  maxCostPerMillion,
}: {
  readonly groups: ReadonlyArray<ProviderGroup>
  readonly activeConfig: ActiveConfig | null
  readonly onSaved: () => void
  readonly maxCostPerMillion: number | null
}) {
  const [search, setSearch] = React.useState("")
  const [activeProvider, setActiveProvider] =
    React.useState<string | null>(null)
  const [selected, setSelected] =
    React.useState<ModelInfo | null>(null)
  const [saving, setSaving] = React.useState(false)

  const currentId =
    activeConfig?.modelId ?? DEFAULT_MODEL_ID

  const query = search.toLowerCase()

  // sort: providers with logos first, then alphabetical
  const sortedGroups = React.useMemo(() => {
    return [...groups].sort((a, b) => {
      const aHas = hasLogo(a.provider) ? 0 : 1
      const bHas = hasLogo(b.provider) ? 0 : 1
      if (aHas !== bHas) return aHas - bHas
      return a.provider.localeCompare(b.provider)
    })
  }, [groups])

  // filter models by search + active provider + cost ceiling
  const filteredGroups = React.useMemo(() => {
    return sortedGroups
      .map((group) => {
        if (
          activeProvider &&
          group.provider !== activeProvider
        ) {
          return { ...group, models: [] }
        }
        return {
          ...group,
          models: [...group.models]
            .filter((m) => {
              if (maxCostPerMillion !== null) {
                if (
                  outputCostPerMillion(
                    m.completionCost
                  ) > maxCostPerMillion
                )
                  return false
              }
              if (!query) return true
              return (
                m.name
                  .toLowerCase()
                  .includes(query) ||
                m.id.toLowerCase().includes(query)
              )
            })
            .sort(
              (a, b) =>
                outputCostPerMillion(
                  a.completionCost
                ) -
                outputCostPerMillion(
                  b.completionCost
                )
            ),
        }
      })
      .filter((g) => g.models.length > 0)
  }, [sortedGroups, activeProvider, query, maxCostPerMillion])

  const isDirty =
    selected !== null && selected.id !== currentId

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    const result = await setActiveModel(
      selected.id,
      selected.name,
      selected.provider,
      selected.promptCost,
      selected.completionCost,
      selected.contextLength
    )
    setSaving(false)
    if (result.success) {
      toast.success("Model updated")
      setSelected(null)
      onSaved()
    } else {
      toast.error(result.error ?? "Failed to save")
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
      {/* search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          className="h-10 pl-9 text-sm"
        />
      </div>

      {/* two-panel layout - no outer border */}
      <div className="flex gap-2 h-80">
        {/* provider sidebar */}
        <div className="w-12 shrink-0 overflow-y-auto flex flex-col items-center gap-1 py-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  setActiveProvider(null)
                }
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-all shrink-0",
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
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0",
                    activeProvider ===
                      group.provider
                      ? "bg-primary/15 scale-110"
                      : "hover:bg-muted"
                  )}
                >
                  <ProviderIcon
                    provider={group.provider}
                    size={22}
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
        <div className="flex-1 overflow-y-auto pr-1">
          {filteredGroups.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              No models found.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredGroups.map((group) =>
                group.models.map((model) => {
                  const isActive =
                    model.id === currentId
                  const isSelected =
                    selected?.id === model.id

                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() =>
                        setSelected(model)
                      }
                      className={cn(
                        "w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 transition-all",
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "bg-muted/40 hover:bg-muted/70",
                        isActive &&
                          !isSelected &&
                          "bg-primary/5 ring-1 ring-primary/20"
                      )}
                    >
                      <ProviderIcon
                        provider={model.provider}
                        size={24}
                        className="shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">
                            {model.name}
                          </span>
                          {isActive && (
                            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 mt-1 font-normal"
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

      {/* save bar */}
      {isDirty && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            Switch to{" "}
            <span className="font-medium text-foreground">
              {selected?.name}
            </span>
          </p>
          <Button
            size="sm"
            className="h-8"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Save
          </Button>
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}

// --- usage metrics ---

const chartConfig = {
  tokens: {
    label: "Tokens",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

function UsageSection({
  metrics,
}: {
  readonly metrics: UsageMetrics
}) {
  return (
    <div className="space-y-3">
      <Label className="text-xs">
        Usage (last 30 days)
      </Label>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border p-2.5">
          <p className="text-muted-foreground text-[10px]">
            Requests
          </p>
          <p className="text-lg font-semibold">
            {metrics.totalRequests.toLocaleString()}
          </p>
        </div>
        <div className="rounded-md border p-2.5">
          <p className="text-muted-foreground text-[10px]">
            Tokens
          </p>
          <p className="text-lg font-semibold">
            {formatTokenCount(metrics.totalTokens)}
          </p>
        </div>
        <div className="rounded-md border p-2.5">
          <p className="text-muted-foreground text-[10px]">
            Est. Cost
          </p>
          <p className="text-lg font-semibold">
            ${metrics.totalCost}
          </p>
        </div>
      </div>

      {metrics.dailyBreakdown.length > 0 && (
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-[10px] mb-2">
            Daily token usage
          </p>
          <ChartContainer
            config={chartConfig}
            className="h-32 w-full"
          >
            <BarChart
              data={[...metrics.dailyBreakdown]}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) =>
                  v.slice(5)
                }
                className="text-[10px]"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={formatTokenCount}
                width={40}
                className="text-[10px]"
              />
              <ChartTooltip
                content={<ChartTooltipContent />}
              />
              <Bar
                dataKey="tokens"
                fill="var(--color-tokens)"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {metrics.modelBreakdown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-[10px]">
            By model
          </p>
          <div className="space-y-1">
            {metrics.modelBreakdown.map((m) => (
              <div
                key={m.modelId}
                className="flex items-center justify-between text-xs rounded-md border px-2.5 py-1.5"
              >
                <span className="truncate max-w-[60%]">
                  {m.modelId}
                </span>
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {m.requests} req &middot;{" "}
                  {formatTokenCount(m.tokens)} tok
                  &middot; ${m.cost}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- main tab ---

export function AIModelTab() {
  const [loading, setLoading] = React.useState(true)
  const [activeConfig, setActiveConfig] =
    React.useState<ActiveConfig | null>(null)
  const [groups, setGroups] = React.useState<
    ReadonlyArray<ProviderGroup>
  >([])
  const [metrics, setMetrics] =
    React.useState<UsageMetrics | null>(null)
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [modelsError, setModelsError] =
    React.useState<string | null>(null)
  const [allowUserSelection, setAllowUserSelection] =
    React.useState(true)
  const [costCeiling, setCostCeiling] =
    React.useState<number | null>(null)
  const [policySaving, setPolicySaving] =
    React.useState(false)

  const loadData = React.useCallback(async () => {
    setLoading(true)

    const configResult = await getActiveModel()
    if (configResult.success) {
      setActiveConfig(configResult.data)
      if (configResult.data) {
        setAllowUserSelection(
          configResult.data.allowUserSelection
        )
        setCostCeiling(
          configResult.data.maxCostPerMillion
            ? parseFloat(
                configResult.data.maxCostPerMillion
              )
            : null
        )
      }
    }

    const [modelsResult, metricsResult] =
      await Promise.all([
        getModelList(),
        getUsageMetrics(),
      ])

    if (modelsResult.success) {
      setGroups(modelsResult.data)
      setModelsError(null)
    } else {
      setModelsError(modelsResult.error)
    }

    if (metricsResult.success) {
      setMetrics(metricsResult.data)
      setIsAdmin(true)
    } else if (
      metricsResult.error !== "Permission denied"
    ) {
      setIsAdmin(false)
    }

    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const SLIDER_MAX = 50

  const filteredModelCount = React.useMemo(() => {
    if (costCeiling === null) return null
    let total = 0
    for (const g of groups) {
      for (const m of g.models) {
        if (
          outputCostPerMillion(
            m.completionCost
          ) <= costCeiling
        ) {
          total++
        }
      }
    }
    return total
  }, [groups, costCeiling])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
        <div className="flex gap-0 rounded-md border overflow-hidden">
          <Skeleton className="h-80 w-14 rounded-none" />
          <Skeleton className="h-80 flex-1 rounded-none" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Active Model</Label>
        {activeConfig ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {activeConfig.modelName}
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0"
            >
              {activeConfig.provider}
            </Badge>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Using default: {DEFAULT_MODEL_ID}
          </p>
        )}
      </div>

      {isAdmin && (
        <>
          <Separator />
          <div className="space-y-3">
            <Label className="text-xs">
              Model Policy
            </Label>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  Allow user model selection
                </p>
                <p className="text-muted-foreground text-xs">
                  When off, all users use the model
                  set above.
                </p>
              </div>
              <Switch
                checked={allowUserSelection}
                onCheckedChange={setAllowUserSelection}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Maximum cost ($/M tokens)
                </p>
                <span className="text-sm font-medium tabular-nums">
                  {costCeiling === null
                    ? "No limit"
                    : `$${costCeiling.toFixed(2)}/M`}
                </span>
              </div>
              <Slider
                min={0}
                max={SLIDER_MAX}
                step={0.1}
                value={[costCeiling ?? SLIDER_MAX]}
                onValueChange={([v]) =>
                  setCostCeiling(
                    v >= SLIDER_MAX ? null : v
                  )
                }
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>$0</span>
                <span>
                  {costCeiling !== null &&
                  filteredModelCount !== null
                    ? `${filteredModelCount} models available`
                    : "All models available"}
                </span>
                <span>$50/M</span>
              </div>
            </div>
            <Button
              size="sm"
              className="h-8"
              disabled={policySaving}
              onClick={async () => {
                setPolicySaving(true)
                const result =
                  await updateModelPolicy(
                    costCeiling !== null
                      ? costCeiling.toFixed(2)
                      : null,
                    allowUserSelection
                  )
                setPolicySaving(false)
                if (result.success) {
                  toast.success("Policy updated")
                  loadData()
                } else {
                  toast.error(
                    result.error ??
                      "Failed to save policy"
                  )
                }
              }}
            >
              {policySaving && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Save Policy
            </Button>
          </div>

          <Separator />
          <div className="space-y-1.5">
            <Label className="text-xs">
              Change Model
            </Label>
            <p className="text-muted-foreground text-xs">
              Select a model from OpenRouter. Applies
              to all users.
            </p>
            {modelsError ? (
              <p className="text-destructive text-xs">
                {modelsError}
              </p>
            ) : (
              <ModelPicker
                groups={groups}
                activeConfig={activeConfig}
                onSaved={loadData}
                maxCostPerMillion={costCeiling}
              />
            )}
          </div>

          <Separator />

          {metrics &&
          metrics.totalRequests > 0 ? (
            <UsageSection metrics={metrics} />
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">Usage</Label>
              <p className="text-muted-foreground text-xs">
                No usage data yet.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
