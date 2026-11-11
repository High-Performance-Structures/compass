"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getClientCompanyOptions,
  joinClientCompany,
  previewClientCompanyJoin,
  type ClientCompanyJoinPreview,
  type ClientCompanyOption,
} from "@/app/actions/client-company-join"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const PERSON_LINE: Readonly<Record<ClientCompanyJoinPreview["person"]["kind"], (name: string, company: string) => string>> = {
  existing: (name, company) => `Listed as ${name}, who is already a person at ${company} with the same email.`,
  own: (name, company) => `Listed as ${name}, this record's own person, now under ${company}.`,
  new: (name, company) => `Added to ${company}'s people as ${name}, with this record's email and phone.`,
}

/**
 * "Company" on a standalone client record: a searchable list of the
 * company's client companies. Choosing one asks for confirmation, then makes
 * this record a person of that company and merges the record into it.
 */
export function ClientCompanyJoinField({
  recordId,
  companyText,
  canEdit,
  onJoined,
}: {
  readonly recordId: string
  /** The company typed on the record before it was linked; shown as a hint only. */
  readonly companyText: string
  readonly canEdit: boolean
  readonly onJoined: () => void
}): React.ReactElement {
  const [options, setOptions] = React.useState<readonly ClientCompanyOption[] | null>(null)
  const [companyId, setCompanyId] = React.useState("")
  const [preview, setPreview] = React.useState<ClientCompanyJoinPreview | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let active = true
    setOptions(null)
    void getClientCompanyOptions(recordId).then((result) => {
      if (!active) return
      if (result.success) setOptions(result.options)
      else toast.error(result.error)
    })
    return () => { active = false }
  }, [recordId])

  React.useEffect(() => {
    if (!companyId) return
    let active = true
    setPreview(null)
    void previewClientCompanyJoin({ recordId, companyId }).then((result) => {
      if (!active) return
      if (result.success) setPreview(result.preview)
      else {
        toast.error(result.error)
        setCompanyId("")
      }
    })
    return () => { active = false }
  }, [recordId, companyId])

  const join = async (): Promise<void> => {
    if (!preview || preview.blockers.length > 0) return
    setBusy(true)
    try {
      const result = await joinClientCompany({ recordId, companyId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${preview.recordName} is now a person at ${preview.companyName}.`)
      if (result.warning) toast.warning(result.warning)
      setCompanyId("")
      onJoined()
    } finally {
      setBusy(false)
    }
  }

  const hint = companyText.trim()
  return (
    <div className="space-y-1.5">
      <Label htmlFor="cust-company-join" className="text-xs">Company</Label>
      <SearchableCombobox
        id="cust-company-join"
        ariaLabel="Client company"
        ariaDescribedBy="cust-company-join-help"
        options={(options ?? []).map((option) => ({
          value: option.id,
          label: option.name,
          ...(option.sageClientNumber ? { description: `Sage ${option.sageClientNumber}` } : {}),
        }))}
        value={companyId}
        onValueChange={setCompanyId}
        placeholder={options === null ? "Loading client companies…" : hint ? `${hint} (not linked)` : "Choose a client company"}
        searchPlaceholder="Search client companies..."
        emptyMessage="No client company matches."
        disabled={!canEdit || options === null}
        className="h-9 w-full"
      />
      <p id="cust-company-join-help" className="text-xs text-muted-foreground">
        Choosing a company makes this person part of it: they are listed under its people, their jobs move with them, and this record is merged into the company.
      </p>
      <AlertDialog open={companyId !== ""} onOpenChange={(open) => { if (!open && !busy) setCompanyId("") }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{preview ? `Join ${preview.companyName}?` : "Join client company?"}</AlertDialogTitle>
            <AlertDialogDescription>
              The client record is merged into the company. It cannot be undone here, and nothing is sent to Sage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview ? (
            <div className="space-y-2 text-sm">
              <p>{PERSON_LINE[preview.person.kind](preview.person.name, preview.companyName)}</p>
              <p>
                {preview.projectContactCount === 0
                  ? "No job contacts to move."
                  : `${preview.projectContactCount} job contact${preview.projectContactCount === 1 ? "" : "s"} on ${preview.projectCount} job${preview.projectCount === 1 ? "" : "s"} will name ${preview.companyName} and this person.`}
              </p>
              {preview.signInMoves ? <p>Their Compass sign-in moves to this person; the sign-in email stays locked.</p> : null}
              {preview.moves.length > 0 ? (
                <div>
                  <p className="font-medium">Also moves to {preview.companyName}</p>
                  <ul className="list-disc pl-5">
                    {preview.moves.map((move) => <li key={move.category}>{move.label}: {move.count}</li>)}
                  </ul>
                </div>
              ) : null}
              {preview.warnings.map((warning) => <p key={warning} className="text-muted-foreground">{warning}</p>)}
              {preview.blockers.map((blocker) => <p key={blocker} className="text-destructive">{blocker}</p>)}
            </div>
          ) : <p className="text-sm text-muted-foreground">Checking the records and job links…</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="button" disabled={busy || !preview || preview.blockers.length > 0} onClick={() => void join()}>
              {busy ? "Joining…" : "Join company"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
