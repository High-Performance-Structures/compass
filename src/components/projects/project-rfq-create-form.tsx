"use client"

import * as React from "react"
import {
  IconPlus,
  IconSend,
  IconShoppingCartQuestion,
} from "@tabler/icons-react"

import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useQuickAddEntry } from "@/hooks/use-quick-add-entry"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

import { RfqCategoryPicker } from "./rfq-create/rfq-category-picker"
import { RfqDocumentLinks } from "./rfq-create/rfq-document-links"
import { DOCUMENT_INPUT_CLASS } from "./rfq-create/rfq-draft"
import { RfqRecipientPicker } from "./rfq-create/rfq-recipient-picker"
import { RfqScopeRows } from "./rfq-create/rfq-scope-rows"
import { RfqSelectionImport } from "./rfq-create/rfq-selection-import"
import { useRfqCreateDraft } from "./rfq-create/use-rfq-create-draft"

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function ProjectRfqCreateForm({
  projectId,
  recipientOptions,
  selectionOptions,
  selectionsSummary,
  costCodeOptions,
}: {
  readonly projectId: string
  readonly recipientOptions: readonly ProjectTaskAssigneeOption[]
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}): React.ReactElement {
  const draft = useRfqCreateDraft({
    projectId,
    recipientOptions,
    selectionOptions,
    selectionsSummary,
    costCodeOptions,
  })
  const {
    formRef,
    open,
    setOpen,
    recipient,
    category,
    priority,
    setPriority,
    selections,
    rows,
    status,
    lineCount,
    documentCount,
    handleSubmit,
  } = draft
  const { selectedRecipient } = recipient

  useQuickAddEntry("rfq", () => {
    setOpen(true)
  })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">
          <IconPlus className="size-4" />
          New RFQ
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,1120px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Request for Quote</SheetTitle>
          <SheetDescription>
            Draft a scope, choose a vendor or trade, and track the response
            date.
          </SheetDescription>
        </SheetHeader>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4 px-5 pb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">RFQ draft</span>
            <span className="text-muted-foreground">
              {lineCount}/{rows.lines.length} scope rows, {documentCount} document{" "}
              {documentCount === 1 ? "link" : "links"}
            </span>
          </div>

          <div className="space-y-3">
            <Field label="RFQ title / scope">
              <Input
                name="title"
                placeholder="Window package quote"
                required
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Overall scope">
              <Textarea
                name="scope"
                placeholder="Summarize the requested work, alternates, assumptions, or exclusions."
                className={`min-h-24 ${DOCUMENT_INPUT_CLASS}`}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RfqRecipientPicker recipient={recipient} />

              <Field label="Recipient email">
                <Input
                  value={recipient.recipientEmail}
                  onChange={(event) => recipient.setRecipientEmail(event.target.value)}
                  placeholder="optional for now"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <RfqCategoryPicker category={category} />
              <Field label="Response needed by">
                <Input
                  name="responseDueDate"
                  type="date"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Priority
                </Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-full rounded-none border-x-0 border-t-0 px-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="compass-content-scroll max-h-72">
                    <SelectItem value="normal">Normal priority</SelectItem>
                    <SelectItem value="high">High priority</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="low">Low priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {selectedRecipient?.source === "directory" && (
            <div className="border-l-4 border-brand-nutech-gold bg-card px-3 py-2 text-sm">
              <p className="font-medium">
                {selectedRecipient.name} is in the directory, but not on this
                project yet.
              </p>
              <p className="mt-1 text-muted-foreground">
                The RFQ can be drafted without granting project portal access.
                Add the contact to the project later if they need to see project
                materials.
              </p>
            </div>
          )}

          {selections.allSelections.length > 0 && (
            <RfqSelectionImport
              selections={selections}
              selectionOptions={selectionOptions}
              selectionsSummary={selectionsSummary}
            />
          )}

          <RfqDocumentLinks projectId={projectId} rows={rows} />

          <RfqScopeRows rows={rows} costCodeOptions={costCodeOptions} />

          {status.kind === "saved" && (
            <p className="border-l-2 border-l-brand-hps-primary px-3 py-2 text-sm text-brand-hps-primary">
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={status.kind === "saving"}>
              {status.kind === "saving" ? (
                <IconSend className="size-4" />
              ) : (
                <IconShoppingCartQuestion className="size-4" />
              )}
              {status.kind === "saving" ? "Creating..." : "Create RFQ"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
