"use client"

import * as React from "react"
import { toast } from "sonner"

import { getSageAddRequestForm, requestSageAdd, type SageAddRequestForm } from "@/app/actions/sage-directory-adds"
import { SageAddDuplicateList } from "@/components/contacts/sage-add-duplicate-list"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Vendor1099Status } from "@/lib/domain/contacts/statuses"
import type { SageDirectoryAddKind } from "@/lib/domain/sage-bridge/statuses"
import type { DuplicateMatch } from "@/lib/sage/directory-add-duplicates"
import { SAGE_ADD_KIND_LABELS, VENDOR_1099_LABELS } from "@/lib/sage/directory-add-request"

export type SageAddRequestTarget = { readonly kind: SageDirectoryAddKind; readonly entityId: string }

const COMPANY_FIELDS = [
  ["name", "Name"], ["addressLine1", "Address"], ["addressLine2", "Address line 2"], ["city", "City"],
  ["state", "State"], ["postalCode", "ZIP"], ["phone", "Phone"], ["email", "Email"],
] as const
const PERSON_FIELDS = [["name", "Name"], ["title", "Job title"], ["phone", "Phone"], ["cellPhone", "Cell phone"], ["email", "Email"]] as const

type Draft = Record<string, string>

function toDraft(fields: Readonly<Record<string, string | null>>): Draft {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? ""]))
}

/**
 * Contacts → "Request add to Sage": staff check the details Sage needs,
 * Compass shows look-alikes (an exact one blocks the request), and the
 * company's approver decides. A vendor whose 1099 isn't known yet can have a
 * W-9 requested right after; that never holds up the Sage add.
 */
export function SageAddRequestDialog({
  target,
  onOpenChange,
  onSubmitted,
  onRequestCompany,
  onLinkSage,
  onRequestW9,
}: {
  readonly target: SageAddRequestTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmitted: () => void
  /** A person whose company isn't in Sage: ask for the company first. */
  readonly onRequestCompany: (target: SageAddRequestTarget) => void
  /** An exact match already in Sage: link this record to it instead. */
  readonly onLinkSage?: (target: SageAddRequestTarget, name: string, sageNumber: string | null) => void
  readonly onRequestW9?: (vendorId: string, name: string) => void
}): React.ReactElement {
  const [form, setForm] = React.useState<SageAddRequestForm | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>({})
  const [vendorType, setVendorType] = React.useState("")
  const [form1099, setForm1099] = React.useState<Vendor1099Status>("unknown")
  const [exact, setExact] = React.useState<readonly DuplicateMatch[]>([])
  const [w9For, setW9For] = React.useState<{ readonly id: string; readonly name: string } | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!target) return
    let cancelled = false
    void getSageAddRequestForm(target.kind, target.entityId).then((result) => {
      if (cancelled) return
      if (!result.success) { setError(result.error); return }
      const loaded = result.data
      setForm(loaded)
      setDraft(toDraft(loaded.target.fields))
      setExact(loaded.duplicates.exact)
      if (loaded.target.kind === "vendor_company" && loaded.target.vendor) {
        setVendorType(loaded.target.vendor.defaultVendorType ?? "")
        setForm1099(loaded.target.vendor.form1099)
      }
    })
    return () => { cancelled = true }
  }, [target])

  const loaded = form?.target ?? null
  const waitingOnCompany = loaded && "parent" in loaded && !loaded.parent.inSage && !loaded.parent.openRequest ? loaded.parent : null
  const blocked = Boolean(loaded?.inSage || loaded?.openRequest || waitingOnCompany)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!target || !loaded || busy) return
    setBusy(true)
    try {
      const fields = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() || null]))
      const input = target.kind === "vendor_company"
        ? { kind: target.kind, entityId: target.entityId, fields, vendorType, form1099 }
        : { kind: target.kind, entityId: target.entityId, fields }
      const result = await requestSageAdd(input)
      if (!result.success) {
        if (result.exact) setExact(result.exact)
        toast.error(result.error)
        return
      }
      toast.success("Sent for approval. You'll hear when it's decided.")
      onSubmitted()
      if (result.data.needsW9 && onRequestW9) {
        setW9For({ id: target.entityId, name: draft.name ?? loaded.name })
        return
      }
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const fieldList = loaded && (loaded.kind === "vendor_company" || loaded.kind === "client_company") ? COMPANY_FIELDS : PERSON_FIELDS

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request add to Sage{target ? `: ${SAGE_ADD_KIND_LABELS[target.kind].toLowerCase()}` : ""}</DialogTitle>
          <DialogDescription>
            Sage numbers it. Your company&apos;s Sage approver decides; nothing goes to Sage before that.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {w9For ? (
          <div className="space-y-3 text-sm">
            <p>Its 1099 isn&apos;t known yet. Ask {w9For.name} for a W-9; the Sage add goes ahead either way.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Later</Button>
              <Button type="button" onClick={() => { onRequestW9?.(w9For.id, w9For.name); onOpenChange(false) }}>Request a W-9</Button>
            </DialogFooter>
          </div>
        ) : loaded ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {loaded.inSage ? <p className="text-sm">{loaded.name} is already in Sage.</p> : null}
            {loaded.openRequest ? <p className="text-sm">{loaded.name} was already asked for. Its request is in Sage requests.</p> : null}
            {waitingOnCompany ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <span>{waitingOnCompany.name} isn&apos;t in Sage yet. Ask for the company first; its people can follow.</span>
                <Button type="button" size="sm" onClick={() => onRequestCompany({ kind: waitingOnCompany.kind, entityId: waitingOnCompany.id })}>
                  Request {waitingOnCompany.name}
                </Button>
              </div>
            ) : null}
            {"parent" in loaded && loaded.parent.openRequest && !loaded.parent.inSage ? (
              <p className="text-xs text-muted-foreground">{loaded.parent.name} is waiting for Sage too; this person follows once it&apos;s added.</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {fieldList.map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`sage-add-${key}`}>{label}</Label>
                  <Input id={`sage-add-${key}`} required={key === "name"} type={key === "email" ? "email" : "text"}
                    maxLength={key === "state" ? 2 : undefined} disabled={blocked}
                    value={draft[key] ?? ""} onChange={(event) => {
                      const value = event.target.value
                      setDraft((current) => ({ ...current, [key]: value }))
                      // A corrected name is checked again when sent.
                      if (key === "name") setExact([])
                    }} />
                </div>
              ))}
              {loaded.kind === "vendor_company" && loaded.vendor ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="sage-add-vendor-type">Sage vendor type</Label>
                    {loaded.vendor.vendorTypes.length > 0 ? (
                      <Select value={vendorType} onValueChange={setVendorType} disabled={blocked}>
                        <SelectTrigger id="sage-add-vendor-type"><SelectValue placeholder="Choose a type" /></SelectTrigger>
                        <SelectContent>
                          {loaded.vendor.vendorTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id="sage-add-vendor-type" value={vendorType} disabled={blocked} onChange={(event) => setVendorType(event.target.value)} />
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sage-add-1099">1099</Label>
                    <Select value={form1099} onValueChange={(value) => setForm1099(value === "yes" || value === "no" ? value : "unknown")} disabled={blocked}>
                      <SelectTrigger id="sage-add-1099"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["yes", "no", "unknown"] as const).map((value) => <SelectItem key={value} value={value}>{VENDOR_1099_LABELS[value]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
            </div>
            {exact.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Already there. Link or merge instead of adding a duplicate:</p>
                <SageAddDuplicateList matches={exact} action={(match) => match.source === "sage" && onLinkSage && target ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onLinkSage(target, loaded.name, match.sageNumber)}>Link to Sage #{match.sageNumber}</Button>
                ) : null} />
              </div>
            ) : null}
            {form && form.duplicates.close.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Look-alikes the approver will see:</p>
                <SageAddDuplicateList matches={form.duplicates.close} />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || blocked || exact.length > 0 || !(draft.name ?? "").trim()}>Send for approval</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
