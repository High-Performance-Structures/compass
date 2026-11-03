"use client"

import { useMemo } from "react"
import { IconPlus, IconRefresh } from "@tabler/icons-react"

import {
  importProjectEstimateFromGoogleSheet,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import type { EstimateAssemblyCopySummary } from "@/app/actions/estimate-project-copies"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { EstimateCopyToProjectButton } from "@/components/projects/estimate-copy-to-project"
import type { useEstimatePricingView } from "@/components/projects/estimate-line-priced-by"
import { ProjectEstimateAssemblyEditor } from "@/components/projects/project-estimate-assembly-editor"
import { ProjectEstimateBuildertrendImport } from "@/components/projects/project-estimate-buildertrend-import"
import { ProjectEstimatePlanSwiftImport } from "@/components/projects/project-estimate-planswift-import"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { formatCents } from "@/lib/format"
import type { EstimateWorkSection } from "@/lib/estimates/workspace-sections"

import { EstimateFeeForms } from "./estimate-fee-forms"
import { EstimateLineEditor } from "./estimate-line-editor"
import { EstimateLineGroups } from "./estimate-line-groups"
import {
  EMPTY_LINE,
  estimateDivisions,
  groupEstimateLines,
  lineEditorIsInline,
  type EstimateBuildView,
  type TaxEntityComboboxOption,
} from "./estimate-workspace-helpers"
import type { EstimateLineEditorState, EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** The "costs" and "fees" areas: estimate lines, imports and builder fee. */
export function EstimateCostsSection({
  runner,
  estimate,
  workspace,
  workSection,
  buildView,
  setBuildView,
  editable,
  editor,
  pricing,
  taxEntityOptions,
  defaultTaxEntityId,
  assemblyCopies,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly workSection: EstimateWorkSection
  readonly buildView: EstimateBuildView
  readonly setBuildView: (view: EstimateBuildView) => void
  readonly editable: boolean
  readonly editor: EstimateLineEditorState
  readonly pricing: ReturnType<typeof useEstimatePricingView>
  readonly taxEntityOptions: readonly TaxEntityComboboxOption[]
  readonly defaultTaxEntityId: string
  readonly assemblyCopies: readonly EstimateAssemblyCopySummary[]
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const divisions = useMemo(
    () => estimateDivisions(workspace.costCodes),
    [workspace.costCodes]
  )
  const mappedCostCodes = useMemo(
    () =>
      new Set(
        workspace.costCodes
          .filter((option) => option.sageMapped)
          .map((option) => option.value)
      ),
    [workspace.costCodes]
  )
  const groupedLines = useMemo(
    () => groupEstimateLines(buildView, workspace.assemblies, workspace.lines),
    [workspace.lines, workspace.assemblies, buildView]
  )
  // What "Copy to another job" can offer: each assembly with its item count.
  const copyGroups = useMemo(() => workspace.assemblies.map((assembly) => ({
    id: assembly.id,
    name: assembly.name,
    lineCount: workspace.lines.filter((line) => line.assemblyId === assembly.id).length,
  })), [workspace.assemblies, workspace.lines])
  const unassignedLineCount = workspace.lines.filter((line) => line.assemblyId === null).length
  // The line editor opens where the person is working; only one copy renders
  // at a time (field ids).
  const editorIsInline = lineEditorIsInline(groupedLines, {
    lineId: editor.line.id,
    insertAfterLineId: editor.insertAfterLineId,
    addToGroupKey: editor.addToGroupKey,
  })

  function renderLineEditor(placement: "inline" | "bottom"): React.ReactElement {
    return (
      <EstimateLineEditor
        placement={placement}
        runner={runner}
        estimate={estimate}
        workspace={workspace}
        editor={editor}
        pricing={pricing}
        divisions={divisions}
        taxEntityOptions={taxEntityOptions}
        defaultTaxEntityId={defaultTaxEntityId}
      />
    )
  }

  function importSourceCsi(): void {
    if (
      workspace.lines.length > 0 &&
      !window.confirm(
        "Importing Project Totals will replace every line in this editable draft. Continue?"
      )
    ) {
      return
    }
    setMessage(null)
    startTransition(async () => {
      const result = await importProjectEstimateFromGoogleSheet(
        projectId,
        estimate.id
      )
      if (!result.success) {
        finish(result.error)
        return
      }
      const rounding = result.roundingAdjustmentCents === 0
        ? ""
        : ` A ${formatCents(Math.abs(result.roundingAdjustmentCents))} source-rounding adjustment was recorded.`
      const mappings =
        !developerModeEnabled || result.missingSageMappingCount === 0
        ? ""
        : ` ${result.missingSageMappingCount} source cost codes require Sage mapping before signature.`
      finish(
        `${result.lineCount} reconciled CSI lines imported for ${formatCents(result.totalCents)}.${rounding}${mappings}`
      )
    })
  }

  return (
      <section
        className="clarity-panel-strong p-4"
        hidden={workSection !== "costs" && workSection !== "fees"}
      >
        <div
          hidden={workSection !== "costs"}
          className="mb-4 flex flex-wrap items-start justify-between gap-3"
        >
          <div>
            <h2 className="font-semibold">{buildView === "assembly" ? "Assembly estimate" : "CSI estimate"}</h2>
            <p className="text-xs text-muted-foreground">
              {buildView === "assembly"
                ? "Build named assemblies using cost codes from any division. Each assembly subtotal updates from its items."
                : "Select a division first, then add the cost codes needed within it. Each division subtotal updates from its lines."}
            </p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <ProjectEstimatePlanSwiftImport
                projectId={projectId}
                estimateId={estimate.id}
                costCodes={workspace.costCodes}
                existingLineCount={workspace.lines.length}
              />
              <ProjectEstimateBuildertrendImport
                projectId={projectId}
                estimateId={estimate.id}
                existingLineCount={workspace.lines.length}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => editor.openLineEditor(EMPTY_LINE)}
              >
                <IconPlus className="size-4" />
                Add estimate line
              </Button>
              {estimate.sourceWorkbookUrl && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={importSourceCsi}
                  disabled={isPending}
                >
                  <IconRefresh
                    className={isPending ? "size-4 animate-spin" : "size-4"}
                  />
                  Import source CSI
                </Button>
              )}
            </div>
          )}
        </div>
        <div
          hidden={workSection !== "costs"}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="estimate-build-view">Build by</Label>
            <SearchableCombobox
              id="estimate-build-view"
              className="w-full sm:w-56"
              ariaLabel="Build estimate by"
              placeholder="Choose build view"
              value={buildView}
              options={[
                { value: "division", label: "Division / cost code" },
                { value: "assembly", label: "Assembly" },
              ]}
              onValueChange={(value) => {
                if (value === "division" || value === "assembly")
                  setBuildView(value)
              }}
            />
          </div>
          {editable && (
            <ProjectEstimateAssemblyEditor projectId={projectId} estimateId={estimate.id} assembly={null} assemblies={workspace.assemblies} lines={workspace.lines} />
          )}
          {workspace.canEdit && (
            <EstimateCopyToProjectButton projectId={projectId} estimateId={estimate.id} groups={copyGroups} unassignedCount={unassignedLineCount} />
          )}
          <p className="text-xs text-muted-foreground">Both views edit the same estimate. Choose the report format separately.</p>
        </div>
        <p
          hidden={workSection !== "fees"}
          className="mb-4 text-xs text-muted-foreground"
        >
          Overhead, margin, and contingency are builder-fee percentages applied
          to eligible estimate items. They remain separate from Sage cost-code
          lines until their accounting mappings are assigned.
        </p>
        <EstimateFeeForms
          runner={runner}
          estimate={estimate}
          workspace={workspace}
          editable={editable}
          hidden={workSection !== "fees"}
        />
        <div hidden={workSection !== "costs"}>
          {groupedLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No estimate lines yet.
            </p>
          ) : (
            <EstimateLineGroups
              runner={runner}
              estimate={estimate}
              workspace={workspace}
              groupedLines={groupedLines}
              buildView={buildView}
              editable={editable}
              editor={editor}
              pricing={pricing}
              mappedCostCodes={mappedCostCodes}
              copyGroups={copyGroups}
              unassignedLineCount={unassignedLineCount}
              assemblyCopies={assemblyCopies}
              defaultTaxEntityId={defaultTaxEntityId}
              renderLineEditor={renderLineEditor}
            />
          )}

          {editable && !editorIsInline && renderLineEditor("bottom")}
        </div>
      </section>
  )
}
