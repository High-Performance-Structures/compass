"use client"

import type { FormEvent } from "react"

import {
  applyProjectEstimateLineMarkup,
  updateProjectEstimateBuilderFee,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCents } from "@/lib/format"

import { formNumber } from "./estimate-workspace-helpers"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** "Apply one line markup" and "Builder fee" forms in the fees area. */
export function EstimateFeeForms({
  runner,
  estimate,
  workspace,
  editable,
  hidden,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly editable: boolean
  readonly hidden: boolean
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner

  function applyLineMarkup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await applyProjectEstimateLineMarkup(
        projectId,
        estimate.id,
        formNumber(formData, "bulkMarkupPercent")
      )
      finish(
        result.success
          ? "Line markup applied to every estimate item."
          : result.error
      )
    })
  }

  function saveBuilderFee(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectEstimateBuilderFee(
        projectId,
        estimate.id,
        {
          overheadPercent: formNumber(formData, "overheadPercent"),
          marginPercent: formNumber(formData, "marginPercent"),
          contingencyPercent: formNumber(formData, "contingencyPercent"),
        }
      )
      finish(result.success ? "Builder fee updated." : result.error)
    })
  }

  return (
        <div
          hidden={hidden}
          className="mb-5 grid gap-4 border-y py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
          <form key={`markup-${estimate.id}-${estimate.updatedAt}`} onSubmit={applyLineMarkup}>
            <h3 className="text-sm font-semibold">Apply one line markup</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Replaces the markup percentage on every current estimate line.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="bulkMarkupPercent">Markup %</Label>
                <Input
                  id="bulkMarkupPercent"
                  name="bulkMarkupPercent"
                  inputMode="decimal"
                  defaultValue={workspace.lines[0]?.markupRateBasisPoints
                    ? workspace.lines[0].markupRateBasisPoints / 100
                    : 0}
                  disabled={!editable}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!editable || isPending || workspace.lines.length === 0}>
                Apply to all lines
              </Button>
            </div>
          </form>
          <form key={`builder-fee-${estimate.id}-${estimate.updatedAt}`} onSubmit={saveBuilderFee}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Builder fee</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Eligible cost base {formatCents(estimate.builderFeeBaseCents)}
                </p>
              </div>
              <p className="font-semibold">{formatCents(estimate.builderFeeCents)}</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="overheadPercent">Overhead %</Label>
                <Input id="overheadPercent" name="overheadPercent" inputMode="decimal" defaultValue={estimate.overheadRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{formatCents(estimate.overheadCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="marginPercent">Margin %</Label>
                <Input id="marginPercent" name="marginPercent" inputMode="decimal" defaultValue={estimate.marginRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{formatCents(estimate.marginCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contingencyPercent">Contingency reserve %</Label>
                <Input id="contingencyPercent" name="contingencyPercent" inputMode="decimal" defaultValue={estimate.contingencyRateBasisPoints / 100} disabled={!editable} />
                <p className="text-xs text-muted-foreground">{formatCents(estimate.contingencyCents)}</p>
              </div>
            </div>
            {editable && (
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={isPending}>Update builder fee</Button>
              </div>
            )}
          </form>
        </div>
  )
}
