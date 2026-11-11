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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { SearchableCombobox } from "@/components/searchable-combobox"
import type { MergeFieldChange, MergeFieldChoice } from "@/lib/domain/contacts/merge-carry-over"

type MergeKind = "customer_company" | "vendor_company" | "customer_person" | "vendor_person"
type Choice = { readonly id: string; readonly name: string; readonly email: string | null }

/**
 * Every contact field the merge changes on the kept record: blanks it fills
 * from the archived record, fields both fill differently (staff pick; the kept
 * record's value by default), and a sign-in email that stays as it is.
 */
function FieldChanges({ changes, choices, onChoose, sageLinked }: {
  readonly changes: readonly MergeFieldChange[]
  readonly choices: Readonly<Record<string, MergeFieldChoice>>
  readonly onChoose: (key: string, choice: MergeFieldChoice) => void
  readonly sageLinked: boolean
}): React.ReactElement {
  if (changes.length === 0) {
    return <p>Contact details: nothing to carry over. The kept record already has every detail the archived one has.</p>
  }
  return (
    <div className="space-y-2">
      <p className="font-medium">Contact details on the kept record</p>
      <ul className="space-y-2">
        {changes.map((change) => (
          <li key={change.key} className="space-y-1">
            <p className="font-medium">{change.label}</p>
            {change.action === "fill" ? (
              <p>Blank on the kept record; takes <span className="font-medium">{change.mergedValue}</span>.</p>
            ) : change.action === "locked" ? (
              <p className="text-muted-foreground">
                Stays {change.keptValue ?? "blank"}: it is the sign-in email of someone who accepted a Compass invite. The archived record keeps {change.mergedValue}.
              </p>
            ) : (
              <RadioGroup
                value={choices[change.key] ?? "kept"}
                className="grid gap-2 sm:grid-cols-2"
                onValueChange={(next) => { if (next === "kept" || next === "merged") onChoose(change.key, next) }}
              >
                <Label htmlFor={`merge-${change.key}-kept`} className="flex items-start gap-2 font-normal">
                  <RadioGroupItem id={`merge-${change.key}-kept`} value="kept" className="mt-0.5" />
                  <span>Keep <span className="font-medium">{change.keptValue}</span></span>
                </Label>
                <Label htmlFor={`merge-${change.key}-merged`} className="flex items-start gap-2 font-normal">
                  <RadioGroupItem id={`merge-${change.key}-merged`} value="merged" className="mt-0.5" />
                  <span>Use <span className="font-medium">{change.mergedValue}</span></span>
                </Label>
              </RadioGroup>
            )}
          </li>
        ))}
      </ul>
      {sageLinked ? (
        <p className="text-muted-foreground">
          The kept record is linked to Sage. Compass shows these details at once; Sage fields go to Sage as a change request for review, like any edit.
        </p>
      ) : null}
      <p className="text-muted-foreground">Values not used stay on the archived record and in the merge audit.</p>
    </div>
  )
}

export function ContactMergeDialog({
  kind,
  choices,
  onOpenChange,
  onMerged,
  picker,
}: {
  readonly kind: MergeKind
  readonly choices: readonly [Choice, Choice] | null
  readonly onOpenChange: (open: boolean) => void
  readonly onMerged: () => void
  /** "Merge with…": finds the second record; the dialog stays open while choices is null. */
  readonly picker?: React.ReactNode
}): React.ReactElement {
  const [keepId, setKeepId] = React.useState("")
  const [preview, setPreview] = React.useState<ContactMergePreview | null>(null)
  const [confirmed, setConfirmed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [fieldChoices, setFieldChoices] = React.useState<Readonly<Record<string, MergeFieldChoice>>>({})
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
    setFieldChoices({})
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
      const result = await mergeDuplicateContacts({ kind, sourceId: source.id, destinationId: destination.id, choices: fieldChoices })
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
    <Dialog open={choices !== null || picker !== undefined} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge duplicate {kind.endsWith("company") ? "companies" : "people"}</DialogTitle>
          <DialogDescription>
            Choose the record to keep. The other is archived and everything linked to it is moved.
            Blank contact details on the kept record are filled from the other; where both differ, you choose.
            This does not merge Sage records or grant Compass access.
          </DialogDescription>
        </DialogHeader>
        {picker}
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
                  {preview.moves.length > 0 ? (
                    <div>
                      <p className="font-medium">Moves to the kept record</p>
                      <ul className="list-disc pl-5">
                        {preview.moves.map((move) => <li key={move.category}>{move.label}: {move.count}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {preview.warnings.map((warning) => <p key={warning} className="text-muted-foreground">{warning}</p>)}
                  {preview.retainedIdentityNotice ? <p className="text-muted-foreground">{preview.retainedIdentityNotice}</p> : null}
                </div>
                <div className="border-b pb-3">
                  <FieldChanges
                    changes={preview.fieldChanges}
                    choices={fieldChoices}
                    sageLinked={preview.survivorSageLinked}
                    onChoose={(key, choice) => setFieldChoices((current) => ({ ...current, [key]: choice }))}
                  />
                </div>
                {preview.blockers.length > 0 ? (
                  <div className="space-y-1 text-destructive">
                    {preview.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                  </div>
                ) : (
                  <label className="flex items-start gap-2">
                    <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
                    <span>I checked both records and want to keep {preview.destinationName}. The contact details listed above change on it as shown.</span>
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
