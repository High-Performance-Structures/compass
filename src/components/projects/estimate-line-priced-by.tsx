"use client"

import * as React from "react"

import {
  getEstimatePricingView,
  type EstimateLinePricingState,
  type EstimatePricingView,
} from "@/app/actions/estimate-line-pricing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { findPricingSource, pricingSourceChoices, pricingSourceOutcome, type PricingSource } from "@/lib/estimates/pricing-sources"

const NO_TODO = "none"

/** Loads the estimate's "Priced by" choices, estimators and per-line state; reload after saves. */
export function useEstimatePricingView(
  projectId: string,
  estimateId: string | null,
): { readonly view: EstimatePricingView | null; readonly reload: () => void } {
  const [view, setView] = React.useState<EstimatePricingView | null>(null)
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    if (!estimateId) return
    let cancelled = false
    void getEstimatePricingView(projectId, estimateId).then((result) => {
      if (!cancelled && result.success) setView(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, estimateId, version])
  const reload = React.useCallback(() => setVersion((current) => current + 1), [])
  return { view, reload }
}

function hasOpenTodo(state: EstimateLinePricingState | undefined): boolean {
  return Boolean(state?.todo && state.todo.status !== "complete" && state.todo.status !== "archived")
}

/** True when saving this line should also make its takeoff to-do. */
export function needsTakeoffTodo(
  sources: readonly PricingSource[],
  sourceId: string,
  estimatorId: string,
  state: EstimateLinePricingState | undefined,
): boolean {
  return findPricingSource(sources, sourceId)?.action === "takeoff" && estimatorId !== "" && !hasOpenTodo(state)
}

/** The "Priced by" row in the estimate line editor. */
export function EstimateLinePricedBy({
  sources,
  estimators,
  value,
  estimatorId,
  state,
  disabled,
  onSourceChange,
  onEstimatorChange,
}: {
  readonly sources: readonly PricingSource[]
  readonly estimators: readonly { readonly value: string; readonly label: string }[]
  readonly value: string
  readonly estimatorId: string
  readonly state: EstimateLinePricingState | undefined
  readonly disabled: boolean
  readonly onSourceChange: (source: PricingSource | null) => void
  readonly onEstimatorChange: (userId: string) => void
}): React.ReactElement | null {
  const choices = pricingSourceChoices(sources, value || null)
  if (choices.length === 0) return null
  const selected = findPricingSource(choices, value)
  const todo = state?.todo ?? null
  return (
    <div className="mt-3 grid gap-2 border-t pt-3">
      <Label id="estimateLinePricedByLabel">Priced by</Label>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby="estimateLinePricedByLabel">
        {choices.map((source) => (
          <Button
            key={source.id}
            type="button"
            size="sm"
            variant={source.id === value ? "default" : "outline"}
            aria-pressed={source.id === value}
            disabled={disabled}
            onClick={() => onSourceChange(source.id === value ? null : source)}
          >
            {source.label}
          </Button>
        ))}
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pricingSourceOutcome(selected)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Choose who gives us this number. Lines with a choice can be saved before the price is in.</p>
      )}
      {selected?.action === "takeoff" &&
        (todo && hasOpenTodo(state) ? (
          <p className="text-sm">
            Takeoff to-do{todo.number ? ` ${todo.number}` : ""} for {todo.assigneeName ?? "staff"} · {todo.status.replace("_", " ")}
          </p>
        ) : (
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="estimateLineEstimator">Takeoff to-do for</Label>
            <Select value={estimatorId || NO_TODO} onValueChange={(next) => onEstimatorChange(next === NO_TODO ? "" : next)} disabled={disabled}>
              <SelectTrigger id="estimateLineEstimator" className="h-9">
                <SelectValue placeholder="Choose an estimator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TODO}>No to-do</SelectItem>
                {estimators.map((staff) => (
                  <SelectItem key={staff.value} value={staff.value}>
                    {staff.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {todo ? <p className="text-xs text-muted-foreground">The last takeoff to-do is {todo.status}. Choose someone to make a new one.</p> : null}
          </div>
        ))}
    </div>
  )
}

/** Badge on an estimate line row: who prices it, and "Needs price" while it's still $0. */
export function EstimateLinePricingBadge({
  sources,
  state,
  lineTotalCents,
}: {
  readonly sources: readonly PricingSource[]
  readonly state: EstimateLinePricingState | undefined
  readonly lineTotalCents: number
}): React.ReactElement | null {
  const source = findPricingSource(sources, state?.pricingSource)
  if (!source) return null
  return (
    <>
      <Badge variant="outline" className="mt-1 ml-1">
        Priced by {source.label}
      </Badge>
      {lineTotalCents <= 0 && (
        <Badge variant="secondary" className="mt-1 ml-1">
          Needs price
        </Badge>
      )}
    </>
  )
}
