"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  mergeDuplicateContacts,
  previewContactMerge,
  type ContactMergePreview,
} from "@/app/actions/contact-duplicates"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchableCombobox } from "@/components/searchable-combobox"

type MergeKind = "customer_company" | "vendor_company" | "customer_person" | "vendor_person"
type Choice = { readonly id: string; readonly name: string; readonly email: string | null }

export function ContactMergeDialog({
  kind,
  choices,
  onOpenChange,
  onMerged,
}: {
  readonly kind: MergeKind
  readonly choices: readonly [Choice, Choice] | null
  readonly onOpenChange: (open: boolean) => void
  readonly onMerged: () => void
}): React.ReactElement {
  const [keepId, setKeepId] = React.useState("")
  const [preview, setPreview] = React.useState<ContactMergePreview | null>(null)
  const [confirmed, setConfirmed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const source = choices?.find((choice) => choice.id !== keepId)
  const destination = choices?.find((choice) => choice.id === keepId)

  React.useEffect(() => {
    setKeepId(choices?.[0].id ?? "")
    setPreview(null)
    setConfirmed(false)
  }, [choices])

  React.useEffect(() => {
    if (!choices || !source || !destination) return
    let active = true
    setPreview(null)
    setConfirmed(false)
    void previewContactMerge({ kind, sourceId: source.id, destinationId: destination.id }).then((result) => {
      if (!active) return
      if (result.success) setPreview(result.preview)
      else toast.error(result.error)
    })
    return () => { active = false }
  }, [choices, kind, source, destination])

  const merge = async (): Promise<void> => {
    if (!source || !destination || !preview || preview.blockers.length > 0 || !confirmed) return
    setBusy(true)
    try {
      const result = await mergeDuplicateContacts({ kind, sourceId: source.id, destinationId: destination.id })
      if (!result.success) { toast.error(result.error); return }
      toast.success("Duplicates merged. The archived record and audit history are retained.")
      if (result.warning) toast.warning(result.warning)
      onOpenChange(false)
      onMerged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={choices !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge duplicate {kind.endsWith("company") ? "companies" : "people"}</DialogTitle>
          <DialogDescription>
            Choose the record to keep. The other is archived and its project links are moved.
            This does not merge Sage records, grant Compass access, or overwrite the survivor&apos;s contact fields.
          </DialogDescription>
        </DialogHeader>
        {choices ? (
          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block font-medium">Keep this record</label>
              <SearchableCombobox
                ariaLabel="Choose record to keep"
                options={choices.map((choice) => ({ value: choice.id, label: `${choice.name}${choice.email ? ` · ${choice.email}` : ""}` }))}
                value={keepId}
                onValueChange={setKeepId}
                placeholder="Choose record..."
                searchPlaceholder="Search selected records..."
                className="w-full"
              />
            </div>
            {preview ? (
              <>
                <div className="space-y-1 border-y py-3">
                  <p><span className="font-medium">Keep:</span> {preview.destinationName}{preview.destinationEmail ? ` · ${preview.destinationEmail}` : ""}</p>
                  <p><span className="font-medium">Archive:</span> {preview.sourceName}{preview.sourceEmail ? ` · ${preview.sourceEmail}` : ""}</p>
                  <p>{preview.peopleCount} people and {preview.projectContactCount} project contacts will be relinked.</p>
                  <p className="text-muted-foreground">Review any different phone, email, or address details before continuing; the survivor&apos;s fields stay unchanged.</p>
                  {preview.retainedIdentityNotice ? <p className="text-muted-foreground">{preview.retainedIdentityNotice}</p> : null}
                </div>
                {preview.blockers.length > 0 ? (
                  <div className="space-y-1 text-destructive">
                    {preview.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                  </div>
                ) : (
                  <label className="flex items-start gap-2">
                    <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
                    <span>I checked both records and want to keep {preview.destinationName}. I understand the archived details stay in the merge audit, not in the survivor&apos;s fields.</span>
                  </label>
                )}
              </>
            ) : <p className="text-muted-foreground">Checking records and project links…</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" disabled={busy || !preview || preview.blockers.length > 0 || !confirmed} onClick={() => void merge()}>
                {busy ? "Merging…" : "Merge duplicates"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
