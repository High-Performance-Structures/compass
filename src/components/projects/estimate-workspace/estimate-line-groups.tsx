"use client"

import { IconTrash } from "@tabler/icons-react"

import {
  deleteProjectEstimateLine,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import type { EstimateAssemblyCopySummary } from "@/app/actions/estimate-project-copies"
import { EstimateAssemblyCopyNotes, EstimateCopyToProjectButton } from "@/components/projects/estimate-copy-to-project"
import { EstimateLinePricingBadge, useEstimatePricingView } from "@/components/projects/estimate-line-priced-by"
import { ProjectEstimateAssemblyEditor } from "@/components/projects/project-estimate-assembly-editor"
import { ProjectEstimateLineBreakdown } from "@/components/projects/project-estimate-line-breakdown"
import { ProjectEstimateLineOrder } from "@/components/projects/project-estimate-line-order"
import { EstimatePhaseExportButton } from "@/components/projects/project-estimate-phase-proposals"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"

import {
  EMPTY_LINE,
  lineDraft,
  percent,
  type EstimateBuildView,
  type EstimateLineGroup,
} from "./estimate-workspace-helpers"
import type { EstimateLineEditorState, EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** The estimate lines grouped by division or assembly, with subtotals. */
export function EstimateLineGroups({
  runner,
  estimate,
  workspace,
  groupedLines,
  buildView,
  editable,
  editor,
  pricing,
  mappedCostCodes,
  copyGroups,
  unassignedLineCount,
  assemblyCopies,
  defaultTaxEntityId,
  renderLineEditor,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly groupedLines: readonly EstimateLineGroup[]
  readonly buildView: EstimateBuildView
  readonly editable: boolean
  readonly editor: EstimateLineEditorState
  readonly pricing: ReturnType<typeof useEstimatePricingView>
  readonly mappedCostCodes: ReadonlySet<string>
  readonly copyGroups: readonly { readonly id: string; readonly name: string; readonly lineCount: number }[]
  readonly unassignedLineCount: number
  readonly assemblyCopies: readonly EstimateAssemblyCopySummary[]
  readonly defaultTaxEntityId: string
  readonly renderLineEditor: (placement: "inline" | "bottom") => React.ReactElement
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const { line, insertAfterLineId, addToGroupKey, openLineEditor } = editor

  function removeLine(lineId: string): void {
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectEstimateLine(
        projectId,
        estimate.id,
        lineId
      )
      finish(result.success ? "Estimate line removed." : result.error)
    })
  }

  return (
            <div className="space-y-4">
              {groupedLines.map((group) => {
                const { items } = group
                const subtotal = items.reduce(
                (sum, item) => sum + item.lineTotalCents,
                0
              )
                return (
                  <div key={group.key} className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-y bg-estimate-section px-3 py-3">
                      <div className="min-w-0 flex-1 break-words">
                        <h3 className="break-words text-sm font-semibold">
                        {group.name}
                      </h3>
                        <p className="text-xs text-muted-foreground">
                          {items.length} cost-code{" "}
                          {items.length === 1 ? "line" : "lines"}
                          {group.description && ` · ${group.description}`}
                        </p>
                        {buildView === "assembly" && (
                          <EstimateAssemblyCopyNotes copies={assemblyCopies} assemblyId={group.assemblyId ?? null} />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <p className="font-semibold">
                          <span className="text-xs font-normal text-muted-foreground">
                            Subtotal{" "}
                          </span>
                          {formatCents(subtotal)}
                        </p>
                        {workspace.canEdit && buildView === "assembly" && group.assemblyId && !estimate.changeOrderId && !estimate.phaseProposalId && (
                          <EstimatePhaseExportButton
                            projectId={projectId}
                            estimateId={estimate.id}
                            assemblyId={group.assemblyId}
                            assemblyName={workspace.assemblies.find((assembly) => assembly.id === group.assemblyId)?.name ?? "Assembly"}
                          />
                        )}
                        {workspace.canEdit && buildView === "assembly" && group.assemblyId && (
                          <EstimateCopyToProjectButton
                            projectId={projectId}
                            estimateId={estimate.id}
                            groups={copyGroups}
                            unassignedCount={unassignedLineCount}
                            preselectedAssemblyId={group.assemblyId}
                          />
                        )}
                        {editable && buildView === "assembly" && (
                          <>
                            {group.assemblyId && (
                              <ProjectEstimateAssemblyEditor projectId={projectId} estimateId={estimate.id} assembly={workspace.assemblies.find((assembly) => assembly.id === group.assemblyId) ?? null} assemblies={workspace.assemblies} lines={workspace.lines} />
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                openLineEditor(
                                  {
                                    ...EMPTY_LINE,
                                    assemblyId: group.assemblyId,
                                  },
                                  null,
                                  group.key
                                )
                              }
                            >
                              Add item
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <ProjectEstimateLineOrder
                      projectId={projectId}
                      estimateId={estimate.id}
                      updatedAt={estimate.updatedAt}
                      group={buildView === "assembly"
                        ? { type: "assembly", assemblyId: group.assemblyId }
                        : { type: "division", divisionCode: group.key }}
                      groupName={group.name}
                      items={items}
                      editable={editable && !isPending}
                      renderItem={(item) => (
                        <div className="py-3 pl-3 pr-3">
                          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div>
                              <p className="text-sm font-medium">
                              {item.costCode} · {item.costCodeName}
                            </p>
                              {item.description.trim() !==
                              item.costCodeName.trim() && (
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {item.description}
                              </p>
                            )}
                              {item.reportPhaseId && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Report phase:{" "}
                                  {workspace.reportPhases.find((phase) => phase.id === item.reportPhaseId)?.name ?? "Default CSI grouping"}
                                </p>
                              )}
                              {!mappedCostCodes.has(item.costCode) && (
                              <Badge variant="outline" className="mt-1">
                                Sage mapping required
                              </Badge>
                            )}
                              {!item.includeInBuilderFee && (
                              <Badge variant="outline" className="mt-1 ml-1">
                                Builder fee excluded
                              </Badge>
                            )}
                              <EstimateLinePricingBadge sources={pricing.view?.sources ?? []} state={pricing.view?.lines[item.id]} lineTotalCents={item.lineTotalCents} />
                              <p className="text-xs text-muted-foreground">
                              {item.costItems.length > 0
                                ? `${item.costItems.length} cost-code breakdown · direct ${formatCents(item.directCostCents)} · markup ${formatCents(item.markupCents)} · tax ${formatCents(item.taxCents)}`
                                : `${item.quantity} ${item.unit} × ${formatCents(item.unitCostCents)} · markup ${percent(item.markupRateBasisPoints)}${item.taxable ? ` · ${item.taxCode ?? "tax"} ${percent(item.taxRateBasisPoints)}` : " · non-taxable"}`}
                            </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="font-medium">{formatCents(item.lineTotalCents)}</span>
                            {editable && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openLineEditor({ ...lineDraft(item), pricingSource: pricing.view?.lines[item.id]?.pricingSource ?? "" })}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openLineEditor(
                                      {
                                        ...EMPTY_LINE,
                                        divisionCode: item.divisionCode,
                                        assemblyId: item.assemblyId,
                                        reportPhaseId: item.reportPhaseId ?? "",
                                      },
                                      item.id
                                    )
                                  }
                                >
                                  Insert below
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Delete ${item.description}`}
                                  onClick={() => removeLine(item.id)}
                                >
                                  <IconTrash className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
                          </div>
                          <ProjectEstimateLineBreakdown
                          projectId={projectId}
                          estimateId={estimate.id}
                          line={item}
                          costCodes={workspace.costCodes}
                          taxEntities={workspace.taxEntities}
                          defaultTaxRateBasisPoints={
                            estimate.defaultTaxRateBasisPoints
                          }
                          defaultTaxEntityId={defaultTaxEntityId}
                          editable={editable}
                        />
                          {editable && (line.id === item.id || (!line.id && insertAfterLineId === item.id)) && (
                            <div className="mt-3">{renderLineEditor("inline")}</div>
                          )}
                        </div>
                      )}
                    />
                    {editable && !line.id && !insertAfterLineId && addToGroupKey === group.key && (
                      <div className="px-3 py-3">{renderLineEditor("inline")}</div>
                    )}
                  </div>
                )
              })}
              <div className="ml-auto max-w-sm space-y-2 border-t bg-estimate-subtotal p-3 text-sm">
                <div className="flex justify-between gap-4">
                <span>Project subtotal</span>
                <span>{formatCents(estimate.directCostCents + estimate.markupCents + estimate.taxCents)}</span>
              </div>
                <div className="flex justify-between gap-4">
                <span>Builder fee</span>
                <span>{formatCents(estimate.builderFeeCents)}</span>
              </div>
                <div className="flex justify-between gap-4 font-semibold">
                <span>Estimate total</span>
                <span>{formatCents(estimate.estimateTotalCents)}</span>
              </div>
              </div>
            </div>
  )
}
