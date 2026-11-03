"use client"

import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"

import {
  saveProjectEstimateLine,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { createEstimateLineTakeoffTodo } from "@/app/actions/estimate-line-pricing"
import { EstimateLinePricedBy, needsTakeoffTodo, useEstimatePricingView } from "@/components/projects/estimate-line-priced-by"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { RateBookFillPicker } from "@/components/rate-book/rate-book-fill-picker"
import { calculateEstimateLine } from "@/lib/domain/estimates/rules"

import { EstimateLineFields, EstimateLinePreview } from "./estimate-line-editor-fields"
import {
  formNumber,
  formText,
  lineDraftCalculationInput,
  type TaxEntityComboboxOption,
} from "./estimate-workspace-helpers"
import type { EstimateLineEditorState, EstimateWorkspaceRunner } from "./use-estimate-line-editor"

export function EstimateLineEditor({
  placement,
  runner,
  estimate,
  workspace,
  editor,
  pricing,
  divisions,
  taxEntityOptions,
  defaultTaxEntityId,
}: {
  readonly placement: "inline" | "bottom"
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly editor: EstimateLineEditorState
  readonly pricing: ReturnType<typeof useEstimatePricingView>
  readonly divisions: readonly (readonly [string, string])[]
  readonly taxEntityOptions: readonly TaxEntityComboboxOption[]
  readonly defaultTaxEntityId: string
}): React.ReactElement {
  const router = useRouter()
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const { line, setLine, insertAfterLineId, addToGroupKey, lineEditorRef, closeLineEditor } = editor
  const availableCostCodes = workspace.costCodes.filter(
    (option) => option.divisionCode === line.divisionCode
  )
  const lineUsesCostBreakdown = Boolean(
    line.id &&
      workspace.lines.find((item) => item.id === line.id)?.costItems.length
  )
  const effectiveLineTaxEntityId = line.taxEntityId || defaultTaxEntityId
  const effectiveLineTaxEntity = workspace.taxEntities.find(
    (option) => option.value === effectiveLineTaxEntityId
  )
  const linePreview = calculateEstimateLine(
    lineDraftCalculationInput(line, effectiveLineTaxEntity?.rateBasisPoints ?? 0)
  )

  function saveLine(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await saveProjectEstimateLine(
        projectId,
        estimate.id,
        line.id,
        {
          costCode: line.costCode,
          reportPhaseId: line.reportPhaseId || null,
          description: formText(formData, "description"),
          specifications: formText(formData, "specifications"),
          quantity: formNumber(formData, "quantity"),
          unit: formText(formData, "unit"),
          unitCost: formNumber(formData, "unitCost"),
          markupPercent: formNumber(formData, "markupPercent"),
          taxable: line.taxable,
          taxEntityId: line.taxEntityId || null,
          ownerVisible: line.ownerVisible,
          includeInBuilderFee: line.includeInBuilderFee,
          assemblyId: line.assemblyId,
          insertAfterLineId,
          pricingSource: line.pricingSource || null,
        }
      )
      let saved = result.success ? "Estimate line saved." : result.error
      if (result.success && pricing.view && needsTakeoffTodo(pricing.view.sources, line.pricingSource, line.takeoffEstimatorId, pricing.view.lines[result.id])) {
        const todo = await createEstimateLineTakeoffTodo(projectId, estimate.id, result.id, line.takeoffEstimatorId)
        saved = todo.success
          ? `Estimate line saved. Takeoff to-do made for ${todo.data.assigneeName ?? "the estimator"}.`
          : `Estimate line saved, but the takeoff to-do wasn't made: ${todo.error}`
      }
      if (result.success) {
        closeLineEditor()
        pricing.reload()
      }
      finish(saved)
    })
  }

  return (
            <form
            ref={lineEditorRef}
            className={placement === "inline" ? "max-w-5xl scroll-mt-24 border-y bg-muted/30 px-3 py-4" : "mt-5 max-w-5xl scroll-mt-6 border-t pt-4"}
            onSubmit={saveLine}
          >
              <h3 className="mb-3 text-sm font-semibold">
              {line.id
                ? "Edit estimate line"
                : insertAfterLineId
                  ? "Insert estimate line"
                  : "Add estimate line"}
            </h3>
              <div className="mb-3 max-w-sm space-y-1.5">
                <Label htmlFor="estimate-line-assembly">Assembly</Label>
                <SearchableCombobox
                  id="estimate-line-assembly"
                  ariaLabel="Assembly"
                  placeholder="Choose assembly"
                  value={line.assemblyId ?? "none"}
                  options={[
                    { value: "none", label: "Other work (no assembly)" },
                    ...workspace.assemblies.map((assembly) => ({
                      value: assembly.id,
                      label: assembly.name,
                      description: assembly.description ?? undefined,
                    })),
                  ]}
                  onValueChange={(value) =>
                    setLine({
                      ...line,
                      assemblyId: value === "none" ? null : value,
                    })
                  }
                />
              </div>
              {!lineUsesCostBreakdown ? (
                <RateBookFillPicker
                  key={line.id ?? "new"}
                  id="estimate-line-rate-book"
                  projectId={projectId}
                  className="mb-3 max-w-sm space-y-1.5"
                  onPick={(option) => {
                    // The cost code depends on the work: a rate's default code
                    // only fills a line that has none yet.
                    const code = option.costCode && !line.costCode
                      ? workspace.costCodes.find((candidate) => candidate.value === option.costCode)
                      : undefined
                    setLine({
                      ...line,
                      divisionCode: code?.divisionCode ?? line.divisionCode,
                      costCode: code?.value ?? line.costCode,
                      description: line.description || option.description,
                      unit: option.unit,
                      unitCost: String(option.unitCostCents / 100),
                      markupPercent: String(option.markupBasisPoints / 100),
                    })
                  }}
                />
              ) : null}
              <EstimateLineFields
                line={line}
                setLine={setLine}
                workspace={workspace}
                divisions={divisions}
                availableCostCodes={availableCostCodes}
                lineUsesCostBreakdown={lineUsesCostBreakdown}
                taxEntityOptions={taxEntityOptions}
              />
              {!lineUsesCostBreakdown && (
                <EstimateLinePreview
                  linePreview={linePreview}
                  taxable={line.taxable}
                  effectiveLineTaxEntity={effectiveLineTaxEntity}
                />
            )}
              {pricing.view && (
                <EstimateLinePricedBy
                  bids={line.id ? {
                    projectId,
                    estimateId: estimate.id,
                    lineId: line.id,
                    // The accepted price is saved on the server; close the
                    // editor so its now-stale values aren't saved over it.
                    onAccepted: () => {
                      closeLineEditor()
                      pricing.reload()
                      router.refresh()
                    },
                  } : null}
                  sources={pricing.view.sources}
                  estimators={pricing.view.estimators}
                  value={line.pricingSource}
                  estimatorId={line.takeoffEstimatorId}
                  state={line.id ? pricing.view.lines[line.id] : undefined}
                  disabled={isPending}
                  onSourceChange={(source) =>
                    setLine({
                      ...line,
                      pricingSource: source?.id ?? "",
                      // Owner scope is the owner's number: no builder fee, no sales tax.
                      ...(source?.ownerScope ? { includeInBuilderFee: false, taxable: false, taxEntityId: "" } : {}),
                    })
                  }
                  onEstimatorChange={(takeoffEstimatorId) => setLine({ ...line, takeoffEstimatorId })}
                />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={line.taxable}
                  disabled={lineUsesCostBreakdown}
                  onCheckedChange={(checked) => {
                    const taxable = checked === true
                    setLine({
                      ...line,
                      taxable,
                      taxEntityId:
                        taxable && !line.taxEntityId
                          ? defaultTaxEntityId
                          : line.taxEntityId,
                    })
                  }}
                />
                Taxable line
              </label>
                <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={line.ownerVisible} onCheckedChange={(checked) => setLine({ ...line, ownerVisible: checked === true })} />
                Owner-visible
              </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={line.includeInBuilderFee}
                    onCheckedChange={(checked) =>
                      setLine({
                        ...line,
                        includeInBuilderFee: checked === true,
                      })
                    }
                  />
                  Include cost in builder-fee calculation
                </label>
                <div className="ml-auto flex gap-2">
                  {(line.id || insertAfterLineId || addToGroupKey !== null) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        closeLineEditor()
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                  type="submit"
                  disabled={
                    isPending ||
                    !line.costCode ||
                    (!lineUsesCostBreakdown &&
                      line.taxable &&
                      !effectiveLineTaxEntity)
                  }
                >
                    <IconPlus className="size-4" />{" "}
                    {line.id
                      ? "Save line"
                      : insertAfterLineId
                        ? "Insert line"
                        : "Add line"}
                  </Button>
                </div>
              </div>
            </form>
  )
}
