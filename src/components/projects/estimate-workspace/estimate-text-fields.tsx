"use client"

import type { ProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Textarea } from "@/components/ui/textarea"
import type { EstimateWorkSection } from "@/lib/estimates/workspace-sections"

import { selectedTemplateBody } from "./estimate-workspace-helpers"
import { SignatureRequiredMark } from "./signature-required-mark"
import type { EstimateHeaderState } from "./use-estimate-header-state"

/** The "contract" and "text" areas of the estimate header form. */
export function EstimateTextFields({
  workspace,
  header,
  editable,
  workSection,
}: {
  readonly workspace: ProjectEstimateWorkspace
  readonly header: EstimateHeaderState
  readonly editable: boolean
  readonly workSection: EstimateWorkSection
}): React.ReactElement {
  const {
    termsTemplateId,
    setTermsTemplateId,
    contractTerms,
    setContractTerms,
    introductionTemplateId,
    setIntroductionTemplateId,
    introductionText,
    setIntroductionText,
    closingTemplateId,
    setClosingTemplateId,
    closingText,
    setClosingText,
  } = header
  return (
    <>
        <div
          hidden={workSection !== "contract"}
          data-estimate-work-section="contract"
        >
          <h2 className="mb-4 font-semibold">Contract terms</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="termsTemplateId">Contract terms template</Label>
            <input type="hidden" name="termsTemplateId" value={termsTemplateId} />
            <SearchableCombobox
              id="termsTemplateId"
              value={termsTemplateId}
              onValueChange={(value) => {
                setTermsTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setContractTerms(
                  selectedTemplateBody(workspace.termsTemplates, value)
                )
              }}
              disabled={!editable}
              options={workspace.termsTemplates}
              ariaLabel="Contract terms template"
              placeholder="Choose a terms template"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
            {workspace.termsTemplates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {workspace.department}-department terms templates are
                available yet. Enter estimate-specific terms below.
              </p>
            )}
          </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="contractTerms">
              Pertinent contract terms<SignatureRequiredMark />
            </Label>
            <Textarea
              id="contractTerms"
              name="contractTerms"
              rows={6}
              value={contractTerms}
              onChange={(event) => setContractTerms(event.target.value)}
              disabled={!editable}
              placeholder="Use a template or draft the estimate-specific terms here."
            />
          </div>
          </div>
        </div>
        <div hidden={workSection !== "text"} data-estimate-work-section="text">
          <h2 className="mb-4 font-semibold">Introduction & closing</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="introductionTemplateId">
              Introductory text template
            </Label>
            <input type="hidden" name="introductionTemplateId" value={introductionTemplateId} />
            <SearchableCombobox
              id="introductionTemplateId"
              value={introductionTemplateId}
              onValueChange={(value) => {
                setIntroductionTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setIntroductionText(
                  selectedTemplateBody(workspace.introductionTemplates, value)
                )
              }}
              disabled={!editable || workspace.introductionTemplates.length === 0}
              options={workspace.introductionTemplates}
              ariaLabel="Introductory text template"
              placeholder="Choose introductory copy"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
          </div>
            <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="closingTemplateId">Closing text template</Label>
            <input type="hidden" name="closingTemplateId" value={closingTemplateId} />
            <SearchableCombobox
              id="closingTemplateId"
              value={closingTemplateId}
              onValueChange={(value) => {
                setClosingTemplateId(value)
                // A cleared or missing template keeps the text already written.
                if (value === "") return
                setClosingText(
                  selectedTemplateBody(workspace.closingTemplates, value)
                )
              }}
              disabled={!editable || workspace.closingTemplates.length === 0}
              options={workspace.closingTemplates}
              ariaLabel="Closing text template"
              placeholder="Choose closing copy"
              searchPlaceholder="Search templates..."
              emptyMessage="No matching templates."
            />
          </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="introductionText">
              Client report introduction
            </Label>
            <Textarea
              id="introductionText"
              name="introductionText"
              rows={4}
              value={introductionText}
              onChange={(event) => setIntroductionText(event.target.value)}
              disabled={!editable}
              placeholder="Optional editable text shown before the estimate detail."
            />
          </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor="closingText">Client report closing text</Label>
            <Textarea
              id="closingText"
              name="closingText"
              rows={4}
              value={closingText}
              onChange={(event) => setClosingText(event.target.value)}
              disabled={!editable}
              placeholder="Optional editable text shown after the estimate detail."
            />
          </div>
          </div>
        </div>
    </>
  )
}
