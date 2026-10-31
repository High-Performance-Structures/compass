"use client"

import { useState } from "react"
import { IconPlus, IconTemplate } from "@tabler/icons-react"

import {
  createProjectEstimateFromTemplate,
  type EstimateTemplateOption,
} from "@/app/actions/estimate-templates"
import { createProjectEstimateDraft } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"

import type { TaxEntityComboboxOption } from "./estimate-workspace-helpers"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** Shown before the project has an estimate: start from a template or blank. */
export function EstimateStartPanel({
  runner,
  canEdit,
  estimateTemplates,
  taxEntityOptions,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly canEdit: boolean
  readonly estimateTemplates: readonly EstimateTemplateOption[]
  readonly taxEntityOptions: readonly TaxEntityComboboxOption[]
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const [startTemplateId, setStartTemplateId] = useState("")
  const [startTaxEntityId, setStartTaxEntityId] = useState("")
  const selectedStartTemplate = estimateTemplates.find(
    (template) => template.id === startTemplateId
  )

  function createEstimate(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectEstimateDraft(projectId)
      finish(result.success ? "Estimate draft created." : result.error)
    })
  }

  function createEstimateFromTemplate(): void {
    if (!startTemplateId) return
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectEstimateFromTemplate({
        projectId,
        templateId: startTemplateId,
        defaultTaxEntityId: startTaxEntityId || null,
      })
      finish(
        result.success
          ? "Estimate draft created from the published template."
          : result.error
      )
    })
  }

  return (
      <section className="clarity-panel-strong p-6">
        <h2 className="text-lg font-semibold">Start the project estimate</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Start with a reviewed company template or a blank CA22 estimate. The
          resulting draft is independent and remains fully editable for this
          project.
        </p>
        {canEdit && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
            <div className="border-y py-4">
              <div className="flex items-center gap-2">
                <IconTemplate className="size-5 text-primary" />
                <h3 className="font-medium">Start from template</h3>
              </div>
              <div className="mt-3 space-y-3">
                <SearchableCombobox
                  value={startTemplateId}
                  onValueChange={setStartTemplateId}
                  options={estimateTemplates.map((template) => ({
                    value: template.id,
                    label: template.name,
                    description: `${template.lineCount} lines`,
                  }))}
                  ariaLabel="Estimate template"
                  placeholder="Choose a published estimate template"
                  searchPlaceholder="Search estimate templates..."
                  emptyMessage="No matching templates."
                />
                <SearchableCombobox
                  value={startTaxEntityId}
                  onValueChange={setStartTaxEntityId}
                  options={[
                {
                  value: "",
                  label: "No project tax entity",
                  keywords: "none clear non-taxable",
                },
                ...taxEntityOptions,
              ]}
                  ariaLabel="Project tax entity for the new estimate"
                  placeholder="Project tax entity, if applicable"
                  searchPlaceholder="Search Sage tax entities..."
                  emptyMessage="No matching Sage tax entities."
                  groupHeading="Active Sage tax entities"
                />
                {selectedStartTemplate?.requiresProjectTaxEntity && (
                  <p className="text-xs text-warning">
                    This template contains taxable lines. Select the project’s
                    tax entity before creating the draft.
                  </p>
                )}
                <Button
                  onClick={createEstimateFromTemplate}
                  disabled={
                    !startTemplateId ||
                    isPending ||
                    Boolean(
                      selectedStartTemplate?.requiresProjectTaxEntity &&
                        !startTaxEntityId
                    )
                  }
                >
                  <IconTemplate className="size-4" />
                  Create from template
                </Button>
                {estimateTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No published estimate templates are available yet.
                  </p>
                )}
              </div>
            </div>
            <div className="hidden items-center text-xs uppercase tracking-wide text-muted-foreground lg:flex">
              or
            </div>
            <div className="border-y py-4">
              <div className="flex items-center gap-2">
                <IconPlus className="size-5 text-primary" />
                <h3 className="font-medium">Start blank</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Build the CSI divisions and cost-code lines manually.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={createEstimate}
                disabled={isPending}
              >
                <IconPlus className="size-4" />
                Create blank estimate
              </Button>
            </div>
          </div>
        )}
      </section>
  )
}
