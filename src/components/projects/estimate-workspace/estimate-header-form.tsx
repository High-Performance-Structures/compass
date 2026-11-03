"use client"

import type { Dispatch, FormEvent, SetStateAction } from "react"

import {
  updateProjectEstimateHeader,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Textarea } from "@/components/ui/textarea"
import {
  isEstimateWorkSection,
  type EstimateWorkSection,
} from "@/lib/estimates/workspace-sections"

import { EstimateSignersFields } from "./estimate-signers-fields"
import { EstimateTextFields } from "./estimate-text-fields"
import {
  formText,
  type LineDraft,
  type TaxEntityComboboxOption,
} from "./estimate-workspace-helpers"
import { SignatureRequiredMark } from "./signature-required-mark"
import type { EstimateHeaderState } from "./use-estimate-header-state"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/**
 * Estimate details, signers, contract terms and introduction/closing text.
 * Every header field stays mounted: saving from any area submits the complete
 * draft.
 */
export function EstimateHeaderForm({
  runner,
  estimate,
  workspace,
  header,
  editable,
  workSection,
  setWorkSection,
  setLine,
  taxEntityOptions,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly header: EstimateHeaderState
  readonly editable: boolean
  readonly workSection: EstimateWorkSection
  readonly setWorkSection: (section: EstimateWorkSection) => void
  readonly setLine: Dispatch<SetStateAction<LineDraft>>
  readonly taxEntityOptions: readonly TaxEntityComboboxOption[]
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const {
    defaultTaxEntityId,
    setDefaultTaxEntityId,
    clientSigners,
    companySigner,
    companySignerInitials,
  } = header

  function saveHeader(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectEstimateHeader(projectId, estimate.id, {
        estimateNumber: formText(formData, "estimateNumber"),
        title: formText(formData, "title"),
        estimateDate: formText(formData, "estimateDate"),
        clientName: formText(formData, "clientName"),
        clientMailingAddress: formText(formData, "clientMailingAddress"),
        clientSignerContactId: clientSigners[0]?.contactId ?? null,
        clientSignerName: clientSigners[0]?.name ?? null,
        clientSignerTitle: clientSigners[0]?.title ?? null,
        clientSignerEmail: clientSigners[0]?.email ?? null,
        clientSigners,
        companySignerContactId: companySigner.contactId,
        companySignerName: companySigner.name,
        companySignerTitle: companySigner.title,
        companySignerEmail: companySigner.email,
        companySignerInitials,
        sourceWorkbookUrl: formText(formData, "sourceWorkbookUrl"),
        defaultTaxEntityId: formText(formData, "defaultTaxEntityId"),
        termsTemplateId: formText(formData, "termsTemplateId"),
        contractTerms: formText(formData, "contractTerms"),
        introductionTemplateId: formText(
          formData,
          "introductionTemplateId"
        ),
        introductionText: formText(formData, "introductionText"),
        closingTemplateId: formText(formData, "closingTemplateId"),
        closingText: formText(formData, "closingText"),
      })
      finish(result.success ? "Estimate details saved." : result.error)
    })
  }

  return (
      <form
        className="clarity-panel-strong p-4"
        hidden={
          !["details", "signers", "contract", "text"].includes(workSection)
        }
        onSubmit={saveHeader}
        onInvalid={(event) => {
          event.preventDefault()
          const field = event.target
          if (
            !(
              field instanceof HTMLInputElement ||
              field instanceof HTMLTextAreaElement
            )
          )
            return
          const section = field
            .closest("[data-estimate-work-section]")
            ?.getAttribute("data-estimate-work-section")
          if (section && isEstimateWorkSection(section)) setWorkSection(section)
          setMessage(field.validationMessage)
          requestAnimationFrame(() => field.focus())
        }}
      >
        <p className="mb-4 text-xs text-muted-foreground">
          <span className="text-destructive" aria-hidden="true">*</span>{" "}
          Required before preparing the estimate for signature.
        </p>
        <div
          hidden={workSection !== "details"}
          data-estimate-work-section="details"
        >
          <h2 className="mb-4 font-semibold">Estimate details</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
            <Label htmlFor="estimateNumber">Estimate number</Label>
            <Input
              id="estimateNumber"
              name="estimateNumber"
              defaultValue={estimate.estimateNumber}
              disabled={!editable}
            />
          </div>
            <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor="estimateTitle">Document name</Label>
            <Input
              id="estimateTitle"
              name="title"
              defaultValue={estimate.title}
              disabled={!editable}
            />
          </div>
            <div className="space-y-1.5">
            <Label htmlFor="estimateDate">
              Estimate date<SignatureRequiredMark />
            </Label>
            <Input
              id="estimateDate"
              name="estimateDate"
              type="date"
              defaultValue={estimate.estimateDate ?? ""}
              disabled={!editable}
            />
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="clientName">Client(s)</Label>
            <Input
              id="clientName"
              name="clientName"
              defaultValue={estimate.clientName ?? ""}
              disabled={!editable}
            />
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="clientMailingAddress">
              Prepared For mailing address
            </Label>
            <Textarea
              id="clientMailingAddress"
              name="clientMailingAddress"
              defaultValue={
                estimate.clientMailingAddress ??
                workspace.projectMailingAddress ??
                ""
              }
              rows={3}
              disabled={!editable}
            />
            <p className="text-xs text-muted-foreground">
              Defaults from the client mailing address on the project and can
              be customized for this estimate.
            </p>
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="sourceWorkbookUrl">Source CSI workbook</Label>
            <Input
              id="sourceWorkbookUrl"
              name="sourceWorkbookUrl"
              type="url"
              defaultValue={estimate.sourceWorkbookUrl ?? ""}
              disabled={!editable}
            />
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="defaultTaxEntityId">Project tax entity</Label>
            <input
              type="hidden"
              name="defaultTaxEntityId"
              value={defaultTaxEntityId}
            />
            <SearchableCombobox
              id="defaultTaxEntityId"
              value={defaultTaxEntityId}
              onValueChange={(value) => {
                setDefaultTaxEntityId(value)
                setLine((current) =>
                  current.taxable && !current.taxEntityId
                    ? { ...current, taxEntityId: value }
                    : current
                )
              }}
              disabled={!editable}
              options={[
                {
                  value: "",
                  label: "No project tax entity",
                  keywords: "none clear non-taxable",
                },
                ...taxEntityOptions,
              ]}
              ariaLabel="Project tax entity"
              placeholder="Select a Sage tax entity"
              searchPlaceholder="Search Sage tax entities..."
              emptyMessage="No matching Sage tax entities."
              groupHeading="Active Sage tax entities"
            />
          </div>
          </div>
        </div>
        <div
          hidden={workSection !== "signers"}
          data-estimate-work-section="signers"
        >
          <h2 className="mb-4 font-semibold">Contract signers</h2>
          <EstimateSignersFields
            estimate={estimate}
            workspace={workspace}
            header={header}
            editable={editable}
          />
        </div>
        <EstimateTextFields
          workspace={workspace}
          header={header}
          editable={editable}
          workSection={workSection}
        />
        {editable && (
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={isPending}>Save draft details</Button>
          </div>
        )}
      </form>
  )
}
