"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  uploadChangeOrderDocuments,
  validateChangeOrderDocumentCount,
} from "@/components/projects/project-change-order-document-upload"
import {
  executeProjectChangeOrderRebaseline,
  updateProjectChangeOrder,
  type ChangeOrderExecutedDocumentInput,
  type ProjectChangeOrderFormOptions,
  type ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { changeOrderMoney } from "@/components/projects/project-change-order-option-picker"
import { ProjectChangeOrderKindChoice } from "@/components/projects/project-change-order-kind-choice"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DriveItemField } from "@/components/google/drive-item-field"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  changeOrderDisplayStatus,
  changeOrderStatusLabel,
  isChangeOrderStatus,
  isExecutedChangeOrderStatus,
} from "@/lib/change-orders/status"
import {
  changeOrderKindLabel,
  isChoosableChangeOrderKind,
  type ChoosableChangeOrderKind,
} from "@/lib/change-orders/kinds"

function optionalText(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(formData: FormData, name: string): string {
  return optionalText(formData, name) ?? ""
}

function scheduleImpactDays(formData: FormData): number | null {
  const value = optionalText(formData, "scheduleImpactDays")
  if (!value) return null
  return Number(value)
}

export function ProjectChangeOrderEditForm({
  item,
  internal,
  formOptions,
}: {
  readonly item: ProjectChangeOrderItem
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
}): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = React.useState(item.documents)
  const [selectedFiles, setSelectedFiles] = React.useState<readonly File[]>([])
  const [kind, setKind] = React.useState<ChoosableChangeOrderKind | null>(
    isChoosableChangeOrderKind(item.kind) ? item.kind : null
  )
  const budgetTreatment =
    kind === "replacement" ? "baseline_replacement" : kind === null ? item.budgetTreatment : "additive"
  // The kind can change until the change order is executed or its estimate is started.
  const kindEditable =
    internal &&
    item.canEdit &&
    item.kind !== "contract_version" &&
    !isExecutedChangeOrderStatus(item.status)
  const estimateStarted = Boolean(item.changeOrderEstimate)
  const [replacementEstimateId, setReplacementEstimateId] = React.useState(
    item.replacementEstimate?.id ?? ""
  )
  const [status, setStatus] = React.useState(item.status)
  const [executedDocumentFile, setExecutedDocumentFile] =
    React.useState<File | null>(null)
  const [executedDocumentUrl, setExecutedDocumentUrl] = React.useState("")
  const [executedDocumentLabel, setExecutedDocumentLabel] = React.useState("")
  const [executedDocumentAttested, setExecutedDocumentAttested] =
    React.useState(false)
  const [saving, startSaving] = React.useTransition()
  const currentBaseline =
    formOptions.estimates.find(
      (estimate) => estimate.id === formOptions.currentBaselineEstimateId
    ) ?? item.baselineEstimate
  const replacementOptions = formOptions.estimates.filter(
    (estimate) =>
      estimate.id !== currentBaseline?.id &&
      estimate.estimateNumber === currentBaseline?.estimateNumber &&
      ["draft", "internal_review", "signature_pending"].includes(
        estimate.status
      )
  )
  const selectedReplacement =
    replacementOptions.find(
      (estimate) => estimate.id === replacementEstimateId
    ) ?? item.replacementEstimate
  const totalCents =
    budgetTreatment === "baseline_replacement" &&
    currentBaseline &&
    selectedReplacement
      ? selectedReplacement.estimateTotalCents -
        currentBaseline.estimateTotalCents
      : kind === "description"
        ? 0
        : kind !== item.kind
          ? null
          : item.amountCents
  const readOnly = !item.canEdit && item.allowedTransitions.length === 0

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const formData = new FormData(form)
    startSaving(async () => {
      try {
        validateChangeOrderDocumentCount(documents.length, selectedFiles)
        const uploaded = await uploadChangeOrderDocuments(
          selectedFiles,
          item.projectId
        )
        const nextDocuments = [
          ...documents.map((document) => ({
            label: document.label,
            url: document.url,
            notes: document.notes,
          })),
          ...uploaded,
        ]
        let executedDocument: ChangeOrderExecutedDocumentInput | null = null
        if (
          status === "executed" &&
          !isExecutedChangeOrderStatus(item.status)
        ) {
          let url = executedDocumentUrl.trim()
          let label = executedDocumentLabel.trim()
          if (executedDocumentFile) {
            if (
              executedDocumentFile.type !== "application/pdf" &&
              !executedDocumentFile.name.toLowerCase().endsWith(".pdf")
            ) {
              throw new Error("The executed change order must be a PDF.")
            }
            if (executedDocumentFile.size > 50 * 1024 * 1024) {
              throw new Error("The executed change-order PDF must be 50 MB or smaller.")
            }
            const [uploadedExecutedDocument] = await uploadChangeOrderDocuments(
              [executedDocumentFile],
              item.projectId
            )
            if (!uploadedExecutedDocument) {
              throw new Error("The executed change-order PDF did not upload.")
            }
            url = uploadedExecutedDocument.url
            label = label || uploadedExecutedDocument.label
          }
          executedDocument = {
            url,
            label,
            attested: executedDocumentAttested,
          }
        }
        const result = await updateProjectChangeOrder(item.projectId, item.id, {
          title: requiredText(formData, "title"),
          scope: requiredText(formData, "scope"),
          reason: optionalText(formData, "reason"),
          scheduleImpactDays: scheduleImpactDays(formData),
          audience:
            optionalText(formData, "audience") === "owner"
              ? "owner"
              : optionalText(formData, "audience") === "sub_vendor"
                ? "sub_vendor"
                : "internal",
          internalNotes: optionalText(formData, "internalNotes"),
          status,
          transitionNote: optionalText(formData, "transitionNote"),
          documents: nextDocuments,
          kind: kindEditable ? kind : null,
          replacementEstimateId:
            internal && budgetTreatment === "baseline_replacement"
              ? replacementEstimateId || null
              : null,
          executedDocument,
        })
        if (!result.success) throw new Error(result.error)

        setDocuments((current) => [
          ...current,
          ...uploaded.map((document) => ({
            id: crypto.randomUUID(),
            ...document,
          })),
        ])
        setSelectedFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ""
        toast.success("Change order request updated.")
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update change order."
        )
      }
    })
  }

  function executeRebaseline(): void {
    const form = formRef.current
    if (!form) return
    if (
      !window.confirm(
        "Replace the current Compass estimate and budget baseline with the linked revised estimate? The prior estimate and budget remain in immutable history."
      )
    ) {
      return
    }
    const formData = new FormData(form)
    startSaving(async () => {
      const result = await executeProjectChangeOrderRebaseline(
        item.projectId,
        item.id,
        optionalText(formData, "transitionNote")
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate and Compass budget rebaselined.")
      router.refresh()
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="space-y-5 border-y bg-background p-4"
    >
      {readOnly && (
        <p className="border-l-2 border-l-muted-foreground px-3 py-2 text-sm text-muted-foreground">
          This record is read-only at its current workflow stage.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm">
        <span className="font-medium">Change order details</span>
        <span className="text-muted-foreground">
          {totalCents === null ? "Priced by its estimate" : `${changeOrderMoney(totalCents)} total`}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="change-order-edit-title">Title</Label>
          <Input
            id="change-order-edit-title"
            name="title"
            defaultValue={item.title}
            disabled={!item.canEdit}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="change-order-edit-schedule-impact">
            Schedule impact (days)
          </Label>
          <Input
            id="change-order-edit-schedule-impact"
            name="scheduleImpactDays"
            type="number"
            min="0"
            max="3650"
            step="1"
            inputMode="numeric"
            defaultValue={item.scheduleImpactDays ?? ""}
            disabled={!item.canEdit}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="change-order-edit-scope">
          {item.sourceType === "buildertrend_import" ? "Recorded scope" : "Scope"}
        </Label>
        <Textarea
          id="change-order-edit-scope"
          name="scope"
          defaultValue={item.scope}
          rows={6}
          disabled={!item.canEdit}
          required
        />
      </div>
      {kindEditable ? (
        <ProjectChangeOrderKindChoice
          kind={kind}
          onKindChange={setKind}
          replacementEstimateId={replacementEstimateId}
          onReplacementEstimateChange={setReplacementEstimateId}
          replacementOptions={replacementOptions}
          currentBaseline={currentBaseline ?? null}
          disabled={false}
          lockedKinds={
            estimateStarted
              ? [
                  { kind: "description", reason: "This change order already has an estimate." },
                  { kind: "replacement", reason: "This change order already has an estimate." },
                ]
              : []
          }
        />
      ) : (
        <p className="border-y py-3 text-sm">
          <span className="text-muted-foreground">How it&apos;s built: </span>
          {changeOrderKindLabel(item.kind)}
        </p>
      )}
      {kind === null && item.kind === null && item.lines.length > 0 && kindEditable && (
        <p className="text-xs text-muted-foreground">
          This change order was recorded with typed cost lines. Choosing how it&apos;s built replaces them; build an
          estimate to price it with phases and assemblies.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="change-order-edit-reason">
          {item.sourceType === "buildertrend_import" ? "Recorded reason" : "Reason"}
        </Label>
        <Textarea
          id="change-order-edit-reason"
          name="reason"
          defaultValue={item.reason ?? ""}
          rows={3}
          disabled={!item.canEdit}
        />
      </div>
      {internal && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="change-order-edit-audience">Audience</Label>
            <Select name="audience" defaultValue={item.audience} disabled={!item.canEdit}>
              <SelectTrigger id="change-order-edit-audience" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Internal only</SelectItem>
                <SelectItem value="owner">Owner visible when approved</SelectItem>
                <SelectItem value="sub_vendor">Sub/vendor request</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-order-internal-notes">Internal notes</Label>
            <Input
              id="change-order-internal-notes"
              name="internalNotes"
              defaultValue={item.internalNotes ?? ""}
              disabled={!item.canEdit}
            />
          </div>
        </div>
      )}
      {item.canEdit && (
        <div className="space-y-3 border-t pt-4">
          <div>
            <p className="text-sm font-medium">Supporting documents</p>
            <p className="text-xs text-muted-foreground">
              Upload photos, proposals, drawings, or other files to the project
              Drive folder.
            </p>
          </div>
          {documents.map((document) => (
            <div
              key={document.id}
              className="flex items-center justify-between gap-3 border-l-2 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">{document.label}</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDocuments((current) =>
                    current.filter((item) => item.id !== document.id)
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={(event) => {
              const files = event.currentTarget.files
              setSelectedFiles(files ? Array.from(files) : [])
            }}
          />
          {selectedFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected for upload
            </p>
          )}
        </div>
      )}
      {internal &&
        status === "executed" &&
        !isExecutedChangeOrderStatus(item.status) && (
          <div className="space-y-4 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Executed change-order PDF</p>
              <p className="text-xs text-muted-foreground">
                Upload the complete signed change order or paste its secure saved
                link. Owners open this authoritative copy through Compass without
                needing separate Google Drive permission.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="change-order-executed-file">
                  Upload executed PDF
                </Label>
                <Input
                  id="change-order-executed-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) =>
                    setExecutedDocumentFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                <p className="text-xs text-muted-foreground">PDF, 50 MB maximum.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="change-order-executed-url">
                  Or secure saved-document link
                </Label>
                <DriveItemField
                  id="change-order-executed-url"
                  value={executedDocumentUrl}
                  onChange={(next) => setExecutedDocumentUrl(next)}
                  projectId={item.projectId}
                  ariaLabel="Saved document"
                  browseTitle="Choose the signed change order"
                  allowOtherLinks
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="change-order-executed-label">
                  Document label
                </Label>
                <Input
                  id="change-order-executed-label"
                  value={executedDocumentLabel}
                  onChange={(event) => setExecutedDocumentLabel(event.target.value)}
                  placeholder="Executed change order.pdf"
                  maxLength={200}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={executedDocumentAttested}
                onCheckedChange={(checked) =>
                  setExecutedDocumentAttested(checked === true)
                }
              />
              <span>
                I confirm this is the complete, fully executed change order and
                contains the required signatures. *
              </span>
            </label>
          </div>
        )}
      <div className="grid gap-4 border-t pt-4 lg:grid-cols-[1fr_2fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="change-order-edit-status">Status</Label>
          <Select
            name="status"
            value={status}
            disabled={readOnly}
            onValueChange={(value) => {
              if (isChangeOrderStatus(value)) setStatus(value)
            }}
          >
            <SelectTrigger id="change-order-edit-status" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={item.status}>
                {changeOrderDisplayStatus(item.status, item.sourceType)}
              </SelectItem>
              {item.allowedTransitions.map((status) => (
                <SelectItem key={status} value={status}>
                  {changeOrderStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="change-order-transition-note">
            Update / transition note
          </Label>
          <Input
            id="change-order-transition-note"
            name="transitionNote"
            placeholder="Explain the decision or information supplied."
          />
        </div>
        <Button
          type="submit"
          className="self-end"
          disabled={
            saving ||
            readOnly ||
            (status === "executed" &&
              !isExecutedChangeOrderStatus(item.status) &&
              (!executedDocumentAttested ||
                (!executedDocumentFile && !executedDocumentUrl.trim())))
          }
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {item.budgetTreatment === "baseline_replacement" &&
        item.status === "signature_pending" && (
          <div className="border-t pt-4">
            {item.rebaselineBlockers.length > 0 ? (
              <div className="border-l-2 border-l-destructive px-3 py-2">
                <p className="text-sm font-medium">Rebaseline is blocked</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {item.rebaselineBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                All preconstruction checks passed. Execution will switch the
                accepted estimate and current Compass budget in one approved
                workflow while retaining both prior revisions.
              </p>
            )}
            <Button
              type="button"
              className="mt-3"
              disabled={saving || !item.canExecuteRebaseline}
              onClick={executeRebaseline}
            >
              {saving ? "Rebaselining…" : "Execute and rebaseline budget"}
            </Button>
          </div>
        )}
    </form>
  )
}
