"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import {
  addProjectEstimateBasisDocument,
  deleteProjectEstimateBasisDocument,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { DriveItemField } from "@/components/google/drive-item-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { formText, statusLabel } from "./estimate-workspace-helpers"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** Plans, specifications and other documents the estimate is based on. */
export function EstimateBasisSection({
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
  const [basisProjectDocumentId, setBasisProjectDocumentId] = useState("")

  function addBasis(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setMessage(null)
    startTransition(async () => {
      const result = await addProjectEstimateBasisDocument(
        projectId,
        estimate.id,
        {
          projectDocumentId: basisProjectDocumentId,
          documentType: formText(formData, "documentType"),
          title: formText(formData, "documentTitle"),
          documentDate: formText(formData, "documentDate"),
          revision: formText(formData, "revision"),
          driveUrl: formText(formData, "driveUrl"),
          notes: formText(formData, "documentNotes"),
        }
      )
      if (result.success) {
        form.reset()
        setBasisProjectDocumentId("")
      }
      finish(result.success ? "Estimate basis added." : result.error)
    })
  }

  function deleteBasisDocument(documentId: string, title: string): void {
    if (
      !window.confirm(
        `Remove “${title}” from this estimate basis? The Google Drive file will not be deleted.`
      )
    ) {
      return
    }
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectEstimateBasisDocument(
        projectId,
        estimate.id,
        documentId
      )
      finish(result.success ? "Estimate basis reference removed." : result.error)
    })
  }

  return (
      <section
        className="clarity-panel-strong p-4"
        hidden={hidden}
      >
        <h2 className="font-semibold">
          Plans, specifications, and estimate basis
        </h2>
        <div className="mt-3 divide-y">
          {workspace.basisDocuments.map((document) => (
            <div
              key={document.id}
              className="flex items-start justify-between gap-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{document.title}</p>
                <p className="text-xs text-muted-foreground">
                  {statusLabel(document.documentType)} ·{" "}
                  {document.documentDate ?? "date not set"}
                  {document.revision ? ` · revision ${document.revision}` : ""}
                </p>
                {document.projectDocumentId && (
                  <p className="mt-1 text-xs font-medium text-primary">
                    Linked to the published project document
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {document.driveUrl && (
                  <Button variant="outline" size="sm" asChild><Link href={document.driveUrl} target="_blank">Open</Link></Button>
                )}
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    aria-label={`Remove ${document.title} from estimate basis`}
                    disabled={isPending}
                    onClick={() => deleteBasisDocument(document.id, document.title)}
                  >
                    <IconTrash className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {editable && (
          <form className="mt-3 grid gap-3 border-t pt-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={addBasis}>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label htmlFor="estimate-basis-project-document">Published project plan or specification</Label>
              <SearchableCombobox
                id="estimate-basis-project-document"
                ariaLabel="Published project document used as estimate basis"
                placeholder="Choose a published document, or enter a legacy reference below"
                searchPlaceholder="Search published plans and specifications..."
                emptyMessage="No published project documents match."
                options={workspace.projectDocumentOptions.map((document) => ({
                  value: document.id,
                  label: document.title,
                  selectedLabel: document.title,
                  description: `${statusLabel(document.category)}${document.revision ? ` · revision ${document.revision}` : ""} · ${document.status}`,
                }))}
                value={basisProjectDocumentId}
                onValueChange={setBasisProjectDocumentId}
              />
              {basisProjectDocumentId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setBasisProjectDocumentId("")}>
                  Use a legacy/manual reference instead
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                This links the exact published revision to the estimate. A later contract packet inherits that estimate basis without changing when newer plans are published.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="documentType">Type</Label>
              <Select name="documentType" defaultValue="architectural_plans">
                <SelectTrigger id="documentType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="architectural_plans">Architectural plans</SelectItem>
                  <SelectItem value="structural_plans">Structural plans</SelectItem>
                  <SelectItem value="specifications">Specifications</SelectItem>
                  <SelectItem value="geotechnical">Geotechnical</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="documentTitle">Legacy/manual title</Label><Input id="documentTitle" name="documentTitle" required={!basisProjectDocumentId} disabled={Boolean(basisProjectDocumentId)} /></div>
            <div className="space-y-1.5"><Label htmlFor="basisDate">Document date</Label><Input id="basisDate" name="documentDate" type="date" /></div>
            <div className="space-y-1.5"><Label htmlFor="basisRevision">Revision</Label><Input id="basisRevision" name="revision" /></div>
            <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="basisDriveUrl">Basis document in Drive</Label><DriveItemField id="basisDriveUrl" name="driveUrl" projectId={projectId} disabled={Boolean(basisProjectDocumentId)} browseTitle="Choose the basis document" /></div>
            <div className="flex items-end"><Button type="submit" disabled={isPending}><IconPlus className="size-4" />Add basis</Button></div>
          </form>
        )}
      </section>
  )
}
