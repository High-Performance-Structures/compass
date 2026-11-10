"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconPencil } from "@tabler/icons-react"

import { updateRfqRequest } from "@/app/actions/project-operations"
import type { ProjectRfqCostCodeOption, ProjectRfqItem } from "@/lib/domain/operations/types"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cleanText } from "@/lib/shared/guards"

import { RfqCategoryPicker } from "./rfq-form/rfq-category-picker"
import { RfqDocumentLinks } from "./rfq-form/rfq-document-links"
import {
  DOCUMENT_INPUT_CLASS,
  toDocumentInput,
  toScopeInput,
} from "./rfq-form/rfq-draft"
import { RfqField, RfqPrioritySelect } from "./rfq-form/rfq-fields"
import { RfqScopeRows } from "./rfq-form/rfq-scope-rows"
import { RfqSelectionImport } from "./rfq-form/rfq-selection-import"
import { useRfqScopeDraft, type RfqScopeDraftInitial } from "./rfq-form/use-rfq-scope-draft"

/*
 * "Edit RFQ" sheet. Uses the same pieces as "New RFQ" (rfq-form/), started
 * from the saved RFQ. The recipient is plain text here; picking a directory
 * contact happens only when the RFQ is created.
 */

type FormStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "error"; readonly message: string }

/** The saved RFQ as draft rows the shared pickers can edit. */
function draftFromRfq(rfq: ProjectRfqItem): RfqScopeDraftInitial {
  return {
    vendorCategory: rfq.vendorCategory ?? "",
    lines: rfq.scopeItems.map((line) => ({
      id: crypto.randomUUID(),
      // Selection links are recorded when the RFQ is created; editing keeps them.
      selectionId: null,
      description: line.description,
      phaseCode: line.phaseCode ?? "",
      costCode: line.costCode ?? "",
      notes: line.notes ?? "",
    })),
    documentLinks: rfq.documentLinks.map((link) => ({
      id: crypto.randomUUID(),
      label: link.label,
      url: link.url,
      notes: link.notes ?? "",
    })),
  }
}

export function ProjectRfqEditForm({
  projectId,
  rfq,
  selectionOptions,
  selectionsSummary,
  costCodeOptions,
}: {
  readonly projectId: string
  readonly rfq: ProjectRfqItem
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [priority, setPriority] = React.useState(rfq.priority)
  const [status, setStatus] = React.useState<FormStatus>({ kind: "idle" })
  const initial = React.useMemo(() => draftFromRfq(rfq), [rfq])
  const { category, selections, rows } = useRfqScopeDraft({
    selectionOptions,
    selectionsSummary,
    costCodeOptions,
    initial,
  })

  async function submitEdit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "saving" })
    const formData = new FormData(event.currentTarget)
    const result = await updateRfqRequest(projectId, rfq.id, {
      title: String(formData.get("title") ?? ""),
      vendorCategory: cleanText(category.vendorCategory),
      requestedFrom: cleanText(String(formData.get("requestedFrom") ?? "")),
      recipientEmail: cleanText(String(formData.get("recipientEmail") ?? "")),
      responseDueDate: cleanText(String(formData.get("responseDueDate") ?? "")),
      priority,
      scope: cleanText(String(formData.get("scope") ?? "")),
      scopeItems: rows.lines.map(toScopeInput),
      documentLinks: rows.documentLinks.map(toDocumentInput),
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setStatus({ kind: "saved" })
    setOpen(false)
    router.refresh()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setStatus({ kind: "idle" })
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconPencil className="size-4" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,1120px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Edit RFQ</SheetTitle>
          <SheetDescription>
            Update scope rows, document links, recipient details, and response
            date.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submitEdit} className="space-y-4 px-5 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">
              {rfq.sourceRecordNumber ?? "RFQ draft"}
            </span>
            <span className="text-muted-foreground">Compass RFQ</span>
          </div>

          {rfq.templateReview && (
            <div className="border-l-2 border-warning px-3 py-2 text-sm">
              <p className="font-medium">Complete the template review before sharing</p>
              {rfq.templateReview.unresolvedPlaceholders.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  Replace: {rfq.templateReview.unresolvedPlaceholders.join(", ")}
                </p>
              )}
              {rfq.templateReview.requiresDocumentPackage && (
                <p className="mt-1 text-muted-foreground">
                  Add the project plans/specifications package below.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <RfqField label="RFQ title / scope">
              <Input
                name="title"
                defaultValue={rfq.title}
                required
                className={DOCUMENT_INPUT_CLASS}
              />
            </RfqField>
            <RfqField label="Overall scope">
              <Textarea
                name="scope"
                defaultValue={rfq.description ?? ""}
                className={`min-h-24 ${DOCUMENT_INPUT_CLASS}`}
              />
            </RfqField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RfqField label="Requested from">
                <Input
                  name="requestedFrom"
                  defaultValue={rfq.companyName ?? rfq.assigneeName ?? ""}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </RfqField>
              <RfqField label="Recipient email">
                <Input
                  name="recipientEmail"
                  defaultValue={rfq.recipientEmail ?? ""}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </RfqField>
              <RfqCategoryPicker category={category} />
              <RfqField label="Response needed by">
                <Input
                  name="responseDueDate"
                  type="date"
                  defaultValue={rfq.dueDate ?? ""}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </RfqField>
              <RfqPrioritySelect priority={priority} onPriorityChange={setPriority} />
            </div>
          </div>

          {selections.allSelections.length > 0 && (
            <RfqSelectionImport
              selections={selections}
              selectionOptions={selectionOptions}
              selectionsSummary={selectionsSummary}
            />
          )}

          <RfqDocumentLinks projectId={projectId} rows={rows} />

          <RfqScopeRows rows={rows} costCodeOptions={costCodeOptions} />

          {status.kind === "error" && (
            <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={status.kind === "saving"}>
              {status.kind === "saved" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconPencil className="size-4" />
              )}
              {status.kind === "saving"
                ? "Saving..."
                : status.kind === "saved"
                  ? "Saved"
                  : "Save RFQ"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
