"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getTradeLetter,
  getTradeLetterComposerDefaults,
  prepareTradeLetterSignature,
  saveTradeLetter,
  type TradeLetterComposerDefaults,
  type TradeLetterRow,
} from "@/app/actions/trade-letters"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TRADE_LETTER_KIND_LABELS, longDate, type TradeLetterKind } from "@/lib/trade-letters/letter"

export type TradeLetterDialogTarget = {
  readonly row: TradeLetterRow
  readonly kind: TradeLetterKind
  /** Reopens a saved draft. */
  readonly letterId: string | null
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

/**
 * Writes a letter of intent or award letter for one selected trade, shows
 * the print preview, and puts it in Foxit: the trade signs first, then you.
 */
export function TradeLetterDialog({
  projectId,
  estimateId,
  target,
  agreementFormSet,
  agreementDocTypeId,
  onOpenChange,
  onSaved,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly target: TradeLetterDialogTarget
  readonly agreementFormSet: boolean
  readonly agreementDocTypeId: string | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}): React.ReactElement {
  const { row, kind } = target
  const [defaults, setDefaults] = React.useState<TradeLetterComposerDefaults | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [letterId, setLetterId] = React.useState<string | null>(target.letterId)
  const [vendorId, setVendorId] = React.useState(row.vendor?.id ?? "")
  const [chosen, setChosen] = React.useState<ReadonlySet<number>>(new Set(row.trade.codes.map((_, index) => index)))
  const [signerName, setSignerName] = React.useState(row.trade.responderName)
  const [signerEmail, setSignerEmail] = React.useState(row.trade.recipientEmail ?? "")
  const [title, setTitle] = React.useState("")
  const [note, setNote] = React.useState("")
  const [includeAgreement, setIncludeAgreement] = React.useState(true)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getTradeLetterComposerDefaults(projectId)
      if (cancelled) return
      if (!result.success) {
        setError(result.error)
        return
      }
      setDefaults(result.data)
      setTitle(result.data.companySignerTitle)
      if (!target.letterId) return
      const saved = await getTradeLetter(projectId, target.letterId)
      if (cancelled || !saved.success) return
      setVendorId(saved.data.vendorId ?? "")
      setChosen(new Set(saved.data.codeIndexes))
      setSignerName(saved.data.signerName)
      setSignerEmail(saved.data.signerEmail)
      setTitle(saved.data.companySignerTitle)
      setNote(saved.data.note)
      setIncludeAgreement(saved.data.includeAgreement)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, target.letterId])

  const total = row.trade.codes.reduce((sum, code, index) => (chosen.has(index) ? sum + code.amountCents : sum), 0)
  const agreementOnFile = row.docs?.agreementSignedOn ?? null
  const sendsAgreement = includeAgreement && agreementFormSet && !agreementOnFile
  const owed = (row.docs?.owed ?? []).filter((item) => !(sendsAgreement && item.id === agreementDocTypeId)).map((item) => item.label)

  async function save(): Promise<string | null> {
    const result = await saveTradeLetter(
      projectId,
      estimateId,
      {
        rfqId: row.trade.rfqId,
        kind,
        vendorId: vendorId || null,
        codeIndexes: [...chosen],
        signerName,
        signerEmail,
        companySignerTitle: title,
        note,
        includeAgreement: sendsAgreement,
      },
      letterId,
    )
    if (!result.success) {
      toast.error(result.error)
      return null
    }
    setLetterId(result.data.id)
    onSaved()
    return result.data.id
  }

  function preview(): void {
    // Open the tab now, while the click still counts, then point it at the PDF.
    const tab = window.open("", "_blank")
    startTransition(async () => {
      const id = await save()
      if (!id) {
        tab?.close()
        return
      }
      const url = `/api/projects/${projectId}/trade-letters/${id}/pdf`
      if (tab) tab.location.href = url
      else window.location.href = url
    })
  }

  function send(): void {
    const tab = window.open("", "_blank")
    startTransition(async () => {
      const id = await save()
      if (!id) {
        tab?.close()
        return
      }
      const prepared = await prepareTradeLetterSignature(projectId, id)
      if (!prepared.success) {
        tab?.close()
        toast.error(prepared.error)
        return
      }
      if (tab) tab.location.href = prepared.data.embeddedSessionUrl
      else window.open(prepared.data.embeddedSessionUrl, "_blank")
      toast.success("Check the letter in Foxit and press Send. It shows as out for signature once Foxit sends it.")
      onOpenChange(false)
    })
  }

  const label = TRADE_LETTER_KIND_LABELS[kind]
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{label}: {row.trade.vendor}</DialogTitle>
          <DialogDescription>
            {kind === "award"
              ? "Accepts their quote in writing. It's signed through Foxit: the trade first, then you."
              : "Holds their place before the owner signs. It's signed through Foxit: the trade first, then you."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !defaults ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="trade-letter-vendor">Vendor</Label>
              <SearchableCombobox
                id="trade-letter-vendor"
                ariaLabel="Vendor"
                placeholder="Choose the vendor"
                searchPlaceholder="Search vendors"
                emptyMessage="No vendor matches."
                options={defaults.vendorOptions.map((vendor) => ({ value: vendor.id, label: vendor.name, description: vendor.category }))}
                value={vendorId}
                onValueChange={setVendorId}
              />
              <p className="text-xs text-muted-foreground">
                {row.vendor ? "Matched from the quote. Their trade docs decide what the letter says is still owed." : "Choose them so the letter can list what's still owed and the signed copy goes in their folder."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="trade-letter-signer">Signs for the trade</Label>
                <Input id="trade-letter-signer" value={signerName} maxLength={120} onChange={(event) => setSignerName(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="trade-letter-signer-email">Their email</Label>
                <Input id="trade-letter-signer-email" type="email" value={signerEmail} maxLength={200} onChange={(event) => setSignerEmail(event.target.value)} />
              </div>
            </div>
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-medium">Scope</legend>
              {row.trade.codes.map((code, index) => (
                <label key={`${code.costCode ?? ""}-${index}`} className="flex items-center justify-between gap-3 border-b py-1.5 text-sm">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={chosen.has(index)}
                      onCheckedChange={(checked) =>
                        setChosen((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(index)
                          else next.delete(index)
                          return next
                        })
                      }
                    />
                    {code.costCode ?? ""} {code.description}
                  </span>
                  <span className="tabular-nums">{money(code.amountCents)}</span>
                </label>
              ))}
              <div className="flex justify-between pt-1 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{money(total)}</span>
              </div>
            </fieldset>
            <div className="grid gap-1.5 text-sm">
              <span className="font-medium">Trade Contractor Agreement</span>
              {agreementOnFile ? (
                <p className="text-muted-foreground">Signed {longDate(agreementOnFile)} and on file. It covers every job, so this letter only accepts the quote.</p>
              ) : agreementFormSet ? (
                <label className="flex items-start gap-2">
                  <Checkbox className="mt-0.5" checked={includeAgreement} onCheckedChange={(checked) => setIncludeAgreement(checked === true)} />
                  <span>No signed agreement on file. Include it so they sign it with this letter; it then covers every job.</span>
                </label>
              ) : (
                <p className="text-muted-foreground">No signed agreement on file. Choose the blank agreement in Settings → Workflows → Trade docs to send it with letters.</p>
              )}
            </div>
            <div className="grid gap-1 text-sm">
              <span className="font-medium">Still owed (listed in the letter)</span>
              <p className="text-muted-foreground">{owed.length > 0 ? owed.join(", ") : row.vendor ? "Nothing. Their docs are complete." : "Unknown until you choose the vendor."}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="trade-letter-title">Your title on the letter</Label>
              <Input id="trade-letter-title" value={title} maxLength={80} placeholder="e.g. President" onChange={(event) => setTitle(event.target.value)} />
              <p className="text-xs text-muted-foreground">You sign second, as {defaults.companySignerName} ({defaults.companySignerEmail}).</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="trade-letter-note">Anything to add</Label>
              <Textarea id="trade-letter-note" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="outline" disabled={pending || !defaults || chosen.size === 0} onClick={preview}>Save and preview</Button>
          <Button type="button" disabled={pending || !defaults || chosen.size === 0} onClick={send}>
            {pending ? "Working…" : "Send for e-signature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
