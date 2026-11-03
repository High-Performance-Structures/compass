"use client"

import type { Dispatch, SetStateAction } from "react"

import type {
  ProjectEstimateCostCodeOption,
  ProjectEstimateTaxOption,
  ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { EstimateUnitInput } from "@/components/estimate-unit-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Textarea } from "@/components/ui/textarea"
import type { EstimateLineCalculation } from "@/lib/domain/estimates/rules"
import { formatCents } from "@/lib/format"

import {
  percent,
  type LineDraft,
  type TaxEntityComboboxOption,
} from "./estimate-workspace-helpers"

/** The line editor's CSI, cost code, description and pricing fields. */
export function EstimateLineFields({
  line,
  setLine,
  workspace,
  divisions,
  availableCostCodes,
  lineUsesCostBreakdown,
  taxEntityOptions,
}: {
  readonly line: LineDraft
  readonly setLine: Dispatch<SetStateAction<LineDraft>>
  readonly workspace: ProjectEstimateWorkspace
  readonly divisions: readonly (readonly [string, string])[]
  readonly availableCostCodes: readonly ProjectEstimateCostCodeOption[]
  readonly lineUsesCostBreakdown: boolean
  readonly taxEntityOptions: readonly TaxEntityComboboxOption[]
}): React.ReactElement {
  return (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="estimate-line-division">CSI division</Label>
                  <SearchableCombobox
                    id="estimate-line-division"
                    value={line.divisionCode}
                    onValueChange={(value) =>
                      setLine({
                        ...line,
                        divisionCode: value,
                        costCode: "",
                        reportPhaseId: "",
                      })
                    }
                    options={divisions.map(([value, label]) => ({
                      value,
                      label,
                      keywords: value,
                    }))}
                    ariaLabel="CSI division"
                    placeholder="Choose division first"
                    searchPlaceholder="Search divisions, e.g. 03 or Concrete..."
                    emptyMessage="No matching divisions."
                  />
                </div>
                <div className="space-y-1.5 xl:col-span-2">
                <Label>Cost code</Label>
                <SearchableCombobox
                  ariaLabel="Estimate cost code"
                  options={availableCostCodes}
                  value={line.costCode}
                  onValueChange={(value) => setLine({ ...line, costCode: value })}
                  disabled={!line.divisionCode}
                  placeholder="Choose cost code"
                  searchPlaceholder="Search Sage cost codes..."
                  emptyMessage="No matching Sage cost codes."
                />
              </div>
                <div className="space-y-1.5">
                <Label htmlFor="estimateUnit">Unit type</Label>
                <EstimateUnitInput
                  id="estimateUnit"
                  name="unit"
                  value={line.unit}
                  disabled={lineUsesCostBreakdown}
                  onValueChange={(value) => setLine({ ...line, unit: value })}
                />
              </div>
                <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                  <Label htmlFor="estimate-report-phase">
                    Customer-facing report phase
                  </Label>
                  <SearchableCombobox
                    id="estimate-report-phase"
                    value={line.reportPhaseId || "__csi__"}
                    onValueChange={(value) =>
                      setLine({
                        ...line,
                        reportPhaseId:
                          value === "__csi__" || value === "" ? "" : value,
                      })
                    }
                    options={[
                      { value: "__csi__", label: "Default CSI grouping" },
                      ...workspace.reportPhases
                        .filter(
                          (phase) => phase.divisionCode === line.divisionCode
                        )
                        .map((phase) => ({ value: phase.id, label: phase.name })),
                    ]}
                    ariaLabel="Customer-facing report phase"
                    placeholder="Default CSI grouping"
                    searchPlaceholder="Search report phases..."
                    emptyMessage="No matching report phases."
                    className="sm:max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">Create phases in Client report settings. CSI cost codes and calculations are unchanged.</p>
                </div>
                <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor="estimateDescription">Description</Label>
                <Input id="estimateDescription" name="description" value={line.description} onChange={(event) => setLine({ ...line, description: event.target.value })} required />
              </div>
                <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                <Label htmlFor="estimateSpecifications">Specifications / scope notes</Label>
                <Textarea id="estimateSpecifications" name="specifications" value={line.specifications} onChange={(event) => setLine({ ...line, specifications: event.target.value })} rows={3} />
              </div>
                <div className="space-y-1.5">
                <Label htmlFor="estimateQuantity">Quantity</Label>
                <Input id="estimateQuantity" name="quantity" inputMode="decimal" value={line.quantity} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, quantity: event.target.value })} />
              </div>
                <div className="space-y-1.5">
                <Label htmlFor="estimateUnitCost">Unit cost</Label>
                <Input id="estimateUnitCost" name="unitCost" inputMode="decimal" value={line.unitCost} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, unitCost: event.target.value })} />
              </div>
                <div className="space-y-1.5">
                <Label htmlFor="estimateMarkup">Line markup %</Label>
                <Input id="estimateMarkup" name="markupPercent" inputMode="decimal" value={line.markupPercent} disabled={lineUsesCostBreakdown} onChange={(event) => setLine({ ...line, markupPercent: event.target.value })} />
              </div>
                <div className="space-y-1.5">
                <Label>Tax entity</Label>
                <SearchableCombobox
                  value={line.taxEntityId}
                  onValueChange={(value) =>
                    setLine({ ...line, taxEntityId: value })
                  }
                  disabled={!line.taxable || lineUsesCostBreakdown}
                  options={[
                    {
                      value: "",
                      label: "Use project tax entity",
                      keywords: "default inherit clear",
                    },
                    ...taxEntityOptions,
                  ]}
                  ariaLabel="Estimate line tax entity"
                  placeholder="Use project tax entity"
                  searchPlaceholder="Search Sage tax entities..."
                  emptyMessage="No matching Sage tax entities."
                  groupHeading="Active Sage tax entities"
                />
              </div>
                {lineUsesCostBreakdown && (
                <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-4">
                  Quantity, unit, unit cost, markup, and tax are calculated from
                  this line&apos;s expanded cost-code breakdown. Edit those pricing
                  values inside the breakdown above.
                </p>
              )}
              </div>
  )
}

/** Live totals for the draft line, from the shared estimate line rules. */
export function EstimateLinePreview({
  linePreview,
  taxable,
  effectiveLineTaxEntity,
}: {
  readonly linePreview: EstimateLineCalculation
  readonly taxable: boolean
  readonly effectiveLineTaxEntity: ProjectEstimateTaxOption | undefined
}): React.ReactElement {
  return (
              <div
                className="mt-3 grid gap-2 border-y py-3 text-sm sm:grid-cols-4"
                aria-live="polite"
              >
                <div>
                  <p className="text-xs text-muted-foreground">Direct cost</p>
                  <p className="font-medium">
                    {formatCents(linePreview.directCostCents)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Markup</p>
                  <p className="font-medium">{formatCents(linePreview.markupCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Sales tax
                    {taxable && effectiveLineTaxEntity
                      ? ` · ${percent(effectiveLineTaxEntity.rateBasisPoints)}`
                      : ""}
                  </p>
                  <p className="font-medium">{formatCents(linePreview.taxCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Line total</p>
                  <p className="font-semibold">
                    {formatCents(linePreview.lineTotalCents)}
                  </p>
                </div>
                {taxable && !effectiveLineTaxEntity && (
                  <p className="text-xs text-destructive sm:col-span-4">
                    Choose a tax entity before saving this taxable line.
                  </p>
                )}
              </div>
  )
}
