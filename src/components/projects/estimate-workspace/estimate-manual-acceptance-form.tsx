"use client"

import type { FormEvent } from "react"
import { IconUpload } from "@tabler/icons-react"

import {
  recordManualProjectEstimateAcceptance,
  type ProjectEstimateSummary,
} from "@/app/actions/project-estimates"
import { EstimateVersionAcceptanceFields } from "@/components/projects/estimate-version-acceptance-fields"
import { uploadEstimateAcceptanceEvidence } from "@/components/projects/project-estimate-acceptance-upload"
import { DriveItemField } from "@/components/google/drive-item-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import type { EstimateApprovalState } from "./estimate-approval-section"
import { formText, localDateInput } from "./estimate-workspace-helpers"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** "Client signed outside Compass": record the signed copy and accept. */
export function EstimateManualAcceptanceForm({
  runner,
  estimate,
  approval,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly approval: EstimateApprovalState
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const {
    acceptanceChangesContract,
    setAcceptanceChangesContract,
    manualAcceptanceAttested,
    setManualAcceptanceAttested,
  } = approval

  function acceptManually(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const fileValue = formData.get("acceptanceEvidenceFile")
    const file = fileValue instanceof File && fileValue.size > 0
      ? fileValue
      : null
    const linkedEvidenceUrl = formText(formData, "acceptanceEvidenceUrl")
    if (file && linkedEvidenceUrl) {
      setMessage("Choose either a file upload or an existing document link.")
      return
    }
    if (!file && !linkedEvidenceUrl && estimate.foxitStatus !== "completed") {
      setMessage("Upload or link the saved signed document.")
      return
    }

    setMessage(null)
    startTransition(async () => {
      try {
        const uploaded = file
          ? await uploadEstimateAcceptanceEvidence(file, projectId)
          : null
        const result = await recordManualProjectEstimateAcceptance(
          projectId,
          estimate.id,
          {
            acceptanceMethod: formText(formData, "acceptanceMethod"),
            clientAcceptedAt: formText(formData, "clientAcceptedAt"),
            evidenceUrl: uploaded?.url ?? linkedEvidenceUrl,
            evidenceLabel:
              uploaded?.label ?? formText(formData, "acceptanceEvidenceLabel"),
            acceptanceNote: formText(formData, "acceptanceNote"),
            attested: manualAcceptanceAttested,
            versionTreatment: formText(formData, "versionTreatment"),
            versionSummary: formText(formData, "versionSummary"),
          }
        )
        if (result.success) {
          form.reset()
          setManualAcceptanceAttested(false)
        }
        finish(
          result.success
            ? acceptanceChangesContract
              ? "Client acceptance recorded; the change order and Budget/G703 were updated."
              : "Client acceptance recorded and the Budget/G703 was created."
            : result.error
        )
      } catch (error) {
        finish(
          error instanceof Error
            ? error.message
            : "Unable to upload the signed document."
        )
      }
    })
  }

  return (
    <form className="space-y-4 border-t pt-4" onSubmit={acceptManually}>
      <div>
        <h3 className="text-sm font-semibold">Client signed outside Compass</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload the scanned contract to the project&apos;s Google Drive
          folder or link the saved signed document.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="acceptanceMethod">Signature method</Label>
          <Select name="acceptanceMethod">
            <SelectTrigger id="acceptanceMethod"><SelectValue placeholder="Choose method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wet_signature">Printed and signed document</SelectItem>
              <SelectItem value="external_esignature">External eSignature</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clientAcceptedAt">Contract execution date</Label>
          <Input id="clientAcceptedAt" name="clientAcceptedAt" type="date" max={localDateInput()} defaultValue={localDateInput()} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acceptanceEvidenceFile">Upload signed document</Label>
          <Input id="acceptanceEvidenceFile" name="acceptanceEvidenceFile" type="file" accept="application/pdf,image/*,.doc,.docx" />
          <p className="text-xs text-muted-foreground">PDF, Word, or image; 50 MB maximum.</p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="acceptanceEvidenceUrl">Or link an existing signed document</Label>
          <DriveItemField id="acceptanceEvidenceUrl" name="acceptanceEvidenceUrl" projectId={projectId} allowOtherLinks browseTitle="Choose the signed document" />
          {estimate.foxitStatus === "completed" && (
            <p className="text-xs text-muted-foreground">Leave blank to use the Foxit-signed copy.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acceptanceEvidenceLabel">Document label</Label>
          <Input id="acceptanceEvidenceLabel" name="acceptanceEvidenceLabel" placeholder="Signed construction estimate" />
          <p className="text-xs text-muted-foreground">Required for a link; uploads use the filename.</p>
        </div>
        <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
          <Label htmlFor="acceptanceNote">Acceptance note</Label>
          <Textarea id="acceptanceNote" name="acceptanceNote" placeholder="Optional context about how the signed contract was received." maxLength={2000} />
        </div>
      </div>
      <EstimateVersionAcceptanceFields
        projectId={projectId}
        estimateId={estimate.id}
        onReplacesContractChange={setAcceptanceChangesContract}
      />
      <div className="flex items-start gap-2 border-t pt-3">
        <Checkbox id="manualAcceptanceAttestation" checked={manualAcceptanceAttested} onCheckedChange={(checked) => setManualAcceptanceAttested(checked === true)} />
        <Label htmlFor="manualAcceptanceAttestation" className="max-w-3xl text-sm font-normal leading-5">
          I confirm this document contains the required client and
          company representative signatures and matches this locked
          estimate version.
        </Label>
      </div>
      <Button type="submit" variant="outline" disabled={isPending || !manualAcceptanceAttested}>
        <IconUpload className="size-4" />
        {acceptanceChangesContract
          ? "Record acceptance and create the change order"
          : "Record executed contract and create Budget/G703"}
      </Button>
    </form>
  )
}
