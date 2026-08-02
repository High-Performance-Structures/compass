"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFileCheck } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  recordManualProjectChangeOrderAcceptance,
  type ProjectChangeOrderItem,
} from "@/app/actions/project-change-orders"
import { uploadChangeOrderDocuments } from "@/components/projects/project-change-order-document-upload"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

function optionalText(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function localDateInput(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

export function ProjectChangeOrderManualAcceptance({
  item,
}: {
  readonly item: ProjectChangeOrderItem
}): React.ReactElement | null {
  const router = useRouter()
  const [attested, setAttested] = React.useState(false)
  const [saving, startSaving] = React.useTransition()
  const eligible =
    item.canApprove &&
    ["approved_for_owner", "signature_pending"].includes(item.status)
  if (!eligible) return null

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const fileValue = formData.get("acceptanceEvidenceFile")
    const file = fileValue instanceof File && fileValue.size > 0
      ? fileValue
      : null
    const linkedEvidenceUrl = optionalText(formData, "acceptanceEvidenceUrl")
    if (file && linkedEvidenceUrl) {
      toast.error("Choose either a file upload or an existing document link.")
      return
    }
    if (!file && !linkedEvidenceUrl) {
      toast.error("Upload or link the owner acceptance evidence.")
      return
    }

    startSaving(async () => {
      try {
        const uploaded = file
          ? (await uploadChangeOrderDocuments([file], item.projectId))[0] ?? null
          : null
        const result = await recordManualProjectChangeOrderAcceptance(
          item.projectId,
          item.id,
          {
            acceptanceMethod: optionalText(formData, "acceptanceMethod"),
            ownerApprovedAt: optionalText(formData, "ownerApprovedAt"),
            evidenceUrl: uploaded?.url ?? linkedEvidenceUrl,
            evidenceLabel:
              uploaded?.label ?? optionalText(formData, "acceptanceEvidenceLabel"),
            acceptanceNote: optionalText(formData, "acceptanceNote"),
            attested,
          }
        )
        if (!result.success) throw new Error(result.error)
        form.reset()
        setAttested(false)
        toast.success("Owner approval recorded and change order executed.")
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not record change-order acceptance."
        )
      }
    })
  }

  return (
    <section className="border-y bg-background p-4">
      <div className="flex items-start gap-3">
        <IconFileCheck className="mt-0.5 size-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">
            Record owner approval outside Compass
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Use this when the owner signed on paper, used another signature
            service, or provided documented written approval.
          </p>
        </div>
      </div>
      <form className="mt-4 space-y-4 border-t pt-4" onSubmit={submit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="co-acceptance-method">Approval method</Label>
            <select
              id="co-acceptance-method"
              name="acceptanceMethod"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              required
            >
              <option value="">Choose method</option>
              <option value="wet_signature">Wet-signed document</option>
              <option value="external_esignature">External e-signature</option>
              <option value="written_owner_approval">Written owner approval</option>
              <option value="historical_executed_contract">
                Historical executed change order
              </option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="co-owner-approved-at">Owner approval date</Label>
            <Input
              id="co-owner-approved-at"
              name="ownerApprovedAt"
              type="date"
              max={localDateInput()}
              defaultValue={localDateInput()}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="co-acceptance-file">Upload approval evidence</Label>
            <Input
              id="co-acceptance-file"
              name="acceptanceEvidenceFile"
              type="file"
              accept="image/*,.pdf,.doc,.docx"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="co-acceptance-url">
              Or existing Google Drive link
            </Label>
            <Input
              id="co-acceptance-url"
              name="acceptanceEvidenceUrl"
              type="url"
              placeholder="https://drive.google.com/..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="co-acceptance-label">Evidence label</Label>
            <Input
              id="co-acceptance-label"
              name="acceptanceEvidenceLabel"
              placeholder="Signed change order"
            />
            <p className="text-xs text-muted-foreground">
              Required for a linked document; uploads use the filename.
            </p>
          </div>
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <Label htmlFor="co-acceptance-note">Acceptance record</Label>
            <Textarea
              id="co-acceptance-note"
              name="acceptanceNote"
              rows={3}
              maxLength={2000}
              placeholder="Who approved it, how approval was received, and any relevant context."
              required
            />
          </div>
        </div>
        <div className="flex items-start gap-2 border-t pt-3">
          <Checkbox
            id="co-acceptance-attestation"
            checked={attested}
            onCheckedChange={(checked) => setAttested(checked === true)}
          />
          <Label
            htmlFor="co-acceptance-attestation"
            className="max-w-3xl text-sm font-normal leading-5"
          >
            I confirm this evidence reflects the owner&apos;s approval and I am
            authorized to record acceptance on the owner&apos;s behalf.
          </Label>
        </div>
        <Button type="submit" disabled={saving || !attested}>
          {saving ? "Recording…" : "Record approval and execute change order"}
        </Button>
      </form>
    </section>
  )
}
