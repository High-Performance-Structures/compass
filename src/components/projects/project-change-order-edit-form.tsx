"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  updateProjectChangeOrder,
  type ProjectChangeOrderFormOptions,
  type ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import {
  changeOrderMoney,
  draftChangeOrderTotalCents,
  initialDraftChangeOrderCostLines,
  ProjectChangeOrderCostLinesEditor,
  toChangeOrderCostLineInput,
  type DraftChangeOrderCostLine,
} from "@/components/projects/project-change-order-cost-lines-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  changeOrderStatusLabel,
  isChangeOrderStatus,
} from "@/lib/change-orders/status"

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
  const [documents, setDocuments] = React.useState(item.documents)
  const [lines, setLines] = React.useState<readonly DraftChangeOrderCostLine[]>(
    initialDraftChangeOrderCostLines(item.lines, item.amountCents)
  )
  const [saving, startSaving] = React.useTransition()
  const totalCents = draftChangeOrderTotalCents(lines)
  const readOnly = !item.canEdit && item.allowedTransitions.length === 0

  function submit(formData: FormData): void {
    startSaving(async () => {
      const requestedStatus = requiredText(formData, "status")
      const status =
        isChangeOrderStatus(requestedStatus) &&
        (requestedStatus === item.status ||
          item.allowedTransitions.includes(requestedStatus))
          ? requestedStatus
          : item.status
      const result = await updateProjectChangeOrder(item.projectId, item.id, {
        title: requiredText(formData, "title"),
        scope: requiredText(formData, "scope"),
        reason: optionalText(formData, "reason"),
        scheduleImpactDays: scheduleImpactDays(formData),
        lines: lines.map(toChangeOrderCostLineInput),
        audience:
          optionalText(formData, "audience") === "owner"
            ? "owner"
            : optionalText(formData, "audience") === "sub_vendor"
              ? "sub_vendor"
              : "internal",
        internalNotes: optionalText(formData, "internalNotes"),
        status,
        transitionNote: optionalText(formData, "transitionNote"),
        documents: documents.map((document) => ({
          label: document.label,
          url: document.url,
          notes: document.notes,
        })),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Change order request updated.")
      router.refresh()
    })
  }

  return (
    <form action={submit} className="space-y-5 border-y bg-background p-4">
      {readOnly && (
        <p className="border-l-2 border-l-muted-foreground px-3 py-2 text-sm text-muted-foreground">
          This record is read-only at its current workflow stage.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm">
        <span className="font-medium">Change order details</span>
        <span className="text-muted-foreground">
          {changeOrderMoney(totalCents)} total
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
        <Label htmlFor="change-order-edit-scope">Scope</Label>
        <Textarea
          id="change-order-edit-scope"
          name="scope"
          defaultValue={item.scope}
          rows={6}
          disabled={!item.canEdit}
          required
        />
      </div>
      <ProjectChangeOrderCostLinesEditor
        lines={lines}
        phaseOptions={formOptions.phases}
        costCodeOptions={formOptions.costCodes}
        disabled={!item.canEdit}
        onLinesChange={setLines}
      />
      <div className="space-y-2">
        <Label htmlFor="change-order-edit-reason">Reason</Label>
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
            <select
              id="change-order-edit-audience"
              name="audience"
              defaultValue={item.audience}
              disabled={!item.canEdit}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="internal">Internal only</option>
              <option value="owner">Owner visible when approved</option>
              <option value="sub_vendor">Sub/vendor request</option>
            </select>
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Document links</p>
              <p className="text-xs text-muted-foreground">
                Links stay in Compass; no document is sent externally.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setDocuments((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    url: "",
                    notes: null,
                  },
                ])
              }
            >
              Add link
            </Button>
          </div>
          {documents.map((document, index) => (
            <div
              key={document.id}
              className="grid gap-2 border-l-2 pl-3 sm:grid-cols-[1fr_2fr_auto]"
            >
              <Input
                value={document.label}
                aria-label={`Document ${index + 1} label`}
                placeholder="Label"
                onChange={(event) =>
                  setDocuments((current) =>
                    current.map((item) =>
                      item.id === document.id
                        ? { ...item, label: event.currentTarget.value }
                        : item
                    )
                  )
                }
              />
              <Input
                value={document.url}
                aria-label={`Document ${index + 1} URL`}
                type="url"
                placeholder="https://..."
                onChange={(event) =>
                  setDocuments((current) =>
                    current.map((item) =>
                      item.id === document.id
                        ? { ...item, url: event.currentTarget.value }
                        : item
                    )
                  )
                }
              />
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
        </div>
      )}
      <div className="grid gap-4 border-t pt-4 lg:grid-cols-[1fr_2fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="change-order-edit-status">Status</Label>
          <select
            id="change-order-edit-status"
            name="status"
            defaultValue={item.status}
            disabled={readOnly}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value={item.status}>
              {changeOrderStatusLabel(item.status)}
            </option>
            {item.allowedTransitions.map((status) => (
              <option key={status} value={status}>
                {changeOrderStatusLabel(status)}
              </option>
            ))}
          </select>
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
          disabled={saving || readOnly}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
