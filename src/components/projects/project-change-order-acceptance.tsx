"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"

import { recordProjectChangeOrderAcceptance } from "@/app/actions/project-change-order-acceptance"
import { DriveItemField } from "@/components/google/drive-item-field"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type {
  ChangeOrderAcceptanceView,
  ChangeOrderManualAcceptanceOptions,
} from "@/lib/change-orders/types"

/** The recorded owner acceptance, shown to staff and the owner. */
export function ProjectChangeOrderAcceptanceSummary({
  acceptance,
  evidenceHref,
}: {
  readonly acceptance: ChangeOrderAcceptanceView
  /** The saved written approval, when there is one. */
  readonly evidenceHref: string | null
}): React.ReactElement {
  return (
    <section className="border-y bg-background p-4" aria-labelledby="change-order-acceptance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="change-order-acceptance" className="flex items-center gap-2 text-sm font-semibold">
            Owner acceptance
            {acceptance.method === "staff_signoff" ? <Badge variant="outline">Manual</Badge> : null}
          </h2>
          <p className="mt-1 text-sm">{acceptance.summary}</p>
          {acceptance.note ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{acceptance.note}</p>
          ) : null}
        </div>
        {evidenceHref ? (
          <Button asChild size="sm" variant="outline">
            <Link href={evidenceHref} target="_blank">
              <IconExternalLink className="size-4" />Open written approval
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function localToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

type Method = "written_approval" | "staff_signoff"

/** Record acceptance: staff record an owner's approval that came by email, text or in person. */
export function ProjectChangeOrderRecordAcceptance({
  projectId,
  changeOrderId,
  options,
}: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly options: ChangeOrderManualAcceptanceOptions
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [method, setMethod] = React.useState<Method>(options.staffSignOff && !options.priced ? "staff_signoff" : "written_approval")
  const [contactId, setContactId] = React.useState(options.approvers[0]?.id ?? "")
  const [approverName, setApproverName] = React.useState(options.approvers.length === 0 ? options.clientName ?? "" : "")
  const [acceptedOn, setAcceptedOn] = React.useState(localToday)
  const [note, setNote] = React.useState("")
  const [confirmed, setConfirmed] = React.useState(false)
  const [evidenceUrl, setEvidenceUrl] = React.useState("")
  const [evidenceLabel, setEvidenceLabel] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  const approverOptions = options.approvers.map((approver) => ({
    value: approver.id,
    label: approver.name,
    description: approver.company ?? undefined,
  }))
  const signOff = method === "staff_signoff"
  const ready =
    (contactId !== "" || approverName.trim() !== "") &&
    acceptedOn !== "" &&
    (signOff ? confirmed && note.trim() !== "" : evidenceUrl.trim() !== "" && evidenceLabel.trim() !== "")

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await recordProjectChangeOrderAcceptance(projectId, changeOrderId, {
        method,
        acceptedByContactId: contactId || null,
        acceptedByName: contactId ? null : approverName,
        acceptedOn,
        note: note.trim() || null,
        confirmed: signOff && confirmed,
        evidence: signOff ? null : { url: evidenceUrl, label: evidenceLabel },
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Acceptance recorded. The change order is executed.")
      if (result.budgetNote) toast.warning(`The contract budget needs review: ${result.budgetNote}`)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Record acceptance
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Record owner acceptance</DialogTitle>
              <DialogDescription>
                For an owner who approved by email, text or in person. Recording it executes the change order.
              </DialogDescription>
            </DialogHeader>
            <RadioGroup value={method} onValueChange={(next) => setMethod(next === "staff_signoff" ? "staff_signoff" : "written_approval")}>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="written_approval" id="co-acceptance-written" />
                <span>
                  <span className="font-medium">Written approval</span>
                  <span className="block text-xs text-muted-foreground">Save the owner&apos;s email or message as evidence.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="staff_signoff" id="co-acceptance-signoff" disabled={!options.staffSignOff} />
                <span>
                  <span className="font-medium">Staff sign-off</span>
                  <span className="block text-xs text-muted-foreground">
                    {options.staffSignOffBlocker ?? "A verbal or in-person approval, with no document."}
                  </span>
                </span>
              </label>
            </RadioGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="co-acceptance-approver">Approved by</Label>
                {approverOptions.length > 0 ? (
                  <SearchableCombobox
                    id="co-acceptance-approver"
                    options={approverOptions}
                    value={contactId}
                    onValueChange={(next) => {
                      if (next) setContactId(next)
                    }}
                    ariaLabel="Approved by"
                    placeholder="Choose the owner contact"
                    disabled={pending}
                  />
                ) : (
                  <Input
                    id="co-acceptance-approver"
                    value={approverName}
                    onChange={(event) => setApproverName(event.target.value)}
                    placeholder="Owner's name"
                    maxLength={200}
                    disabled={pending}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="co-acceptance-date">Approval date</Label>
                <Input
                  id="co-acceptance-date"
                  type="date"
                  value={acceptedOn}
                  max={localToday()}
                  onChange={(event) => setAcceptedOn(event.target.value)}
                  disabled={pending}
                />
              </div>
            </div>

            {signOff ? null : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="co-acceptance-evidence">Written approval (PDF or image)</Label>
                  <DriveItemField
                    id="co-acceptance-evidence"
                    value={evidenceUrl}
                    onChange={(next, item) => {
                      setEvidenceUrl(next)
                      if (item && !evidenceLabel.trim()) setEvidenceLabel(item.name)
                    }}
                    projectId={projectId}
                    ariaLabel="Written approval"
                    browseTitle="Choose the owner's written approval"
                    disabled={pending}
                    allowOtherLinks
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="co-acceptance-evidence-label">Document label</Label>
                  <Input
                    id="co-acceptance-evidence-label"
                    value={evidenceLabel}
                    onChange={(event) => setEvidenceLabel(event.target.value)}
                    placeholder="Owner approval email.pdf"
                    maxLength={200}
                    disabled={pending}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="co-acceptance-note">{signOff ? "Note (required)" : "Note (optional)"}</Label>
              <Textarea
                id="co-acceptance-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={signOff ? "Owner approved on site during the walkthrough." : ""}
                maxLength={2000}
                disabled={pending}
              />
            </div>

            {signOff ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} disabled={pending} />
                <span>I approve recording this change order as accepted.</span>
              </label>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !ready}>
                {pending ? "Recording…" : "Record acceptance"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
