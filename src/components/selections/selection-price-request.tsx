"use client"

/*
 * "Ask supplier to price": the chosen choices become scope lines on a normal
 * RFQ, either a new draft for a supplier or added to an unsent draft on this
 * job. The RFQ is then sent from the RFQs page as usual (email with the
 * no-login price link); the prices the supplier enters fill the choices.
 */
import * as React from "react"
import { useRouter } from "next/navigation"

import { priceSelectionChoicesByRfq } from "@/app/actions/project-operations"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import type { DraftRfqOption, SupplierOption } from "@/lib/domain/selections/selection-sheet-read"

const NEW_RFQ = "__new__"

export function SelectionPriceRequest({
  projectId,
  selectionId,
  choices,
  suppliers,
  draftRfqs,
  open,
  onOpenChange,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly choices: readonly SelectionChoiceView[]
  readonly suppliers: readonly SupplierOption[]
  readonly draftRfqs: readonly DraftRfqOption[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set())
  const [target, setTarget] = React.useState(NEW_RFQ)
  const [supplierId, setSupplierId] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [due, setDue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    // Unpriced choices are ticked to start with.
    setPicked(new Set(choices.filter((choice) => choice.priceCents === null).map((choice) => choice.id)))
    setTarget(NEW_RFQ)
    setError(null)
  }, [open, choices])

  function chooseSupplier(id: string): void {
    setSupplierId(id)
    setEmail(suppliers.find((supplier) => supplier.id === id)?.email ?? "")
  }

  function toggle(id: string, on: boolean): void {
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function submit(): void {
    setError(null)
    const supplier = suppliers.find((item) => item.id === supplierId) ?? null
    startTransition(async () => {
      const result = await priceSelectionChoicesByRfq(projectId, {
        selectionId,
        choiceIds: choices.filter((choice) => picked.has(choice.id)).map((choice) => choice.id),
        rfqId: target === NEW_RFQ ? null : target,
        requestedFrom: supplier?.name ?? null,
        recipientEmail: email.trim() || null,
        responseDueDate: due || null,
        vendorPick: supplier ? { projectContactId: null, vendorId: supplier.id } : null,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      router.push(`/dashboard/projects/${encodeURIComponent(projectId)}/rfqs?created=${encodeURIComponent(result.id)}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask supplier to price</DialogTitle>
          <DialogDescription>
            Makes an RFQ draft with one line per choice. Send it from the RFQs page; the prices the supplier enters fill these choices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Choices to price</legend>
            {choices.map((choice) => (
              <label key={choice.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.has(choice.id)} onCheckedChange={(value) => toggle(choice.id, value === true)} />
                <span className="min-w-0 truncate">{choice.title}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label>RFQ</Label>
            <SearchableCombobox
              ariaLabel="RFQ"
              value={target}
              onValueChange={setTarget}
              options={[
                { value: NEW_RFQ, label: "New RFQ" },
                ...draftRfqs.map((rfq) => ({
                  value: rfq.id,
                  label: `Add to ${[rfq.number, rfq.title, rfq.companyName].filter(Boolean).join(" · ")}`,
                })),
              ]}
              placeholder="New RFQ"
            />
          </div>
          {target === NEW_RFQ && (
            <>
              <div className="grid gap-1.5">
                <Label>Supplier</Label>
                <SearchableCombobox
                  ariaLabel="Supplier"
                  value={supplierId}
                  onValueChange={chooseSupplier}
                  options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
                  placeholder="Choose a supplier (or leave blank)"
                  searchPlaceholder="Search suppliers…"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="price-request-email">Send to</Label>
                  <Input id="price-request-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="supplier@example.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="price-request-due">Prices due</Label>
                  <Input id="price-request-due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
                </div>
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || picked.size === 0} onClick={submit}>
            {pending ? "Making RFQ…" : target === NEW_RFQ ? "Make RFQ draft" : "Add to RFQ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
