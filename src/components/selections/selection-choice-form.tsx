"use client"

/*
 * Add or edit one choice under a selection: title, description, supplier
 * (a vendor record, or typed when the supplier isn't in Compass yet), the
 * supplier's price (staff only), the owner price (what the owner sees,
 * including the builder fee), lead time and status.
 */
import * as React from "react"

import { saveSelectionChoice } from "@/app/actions/selection-choices"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import type { SupplierOption } from "@/lib/domain/selections/selection-sheet-read"
import { SELECTION_CHOICE_STATUSES, type SelectionChoiceStatus } from "@/lib/domain/selections/statuses"

const STATUS_LABELS: Readonly<Record<SelectionChoiceStatus, string>> = {
  proposed: "Proposed",
  available: "Available",
  unavailable: "Unavailable",
  declined: "Declined",
}

const NO_VENDOR = "__typed__"

function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2)
}

export function SelectionChoiceForm({
  projectId,
  selectionId,
  choice,
  suppliers,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly projectId: string
  readonly selectionId: string
  /** The choice to edit; null adds a new one. */
  readonly choice: SelectionChoiceView | null
  readonly suppliers: readonly SupplierOption[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}): React.ReactElement {
  const [vendorId, setVendorId] = React.useState(choice?.vendorId ?? NO_VENDOR)
  const [status, setStatus] = React.useState<SelectionChoiceStatus>(choice?.status ?? "proposed")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const formId = React.useId()

  React.useEffect(() => {
    if (!open) return
    setVendorId(choice?.vendorId ?? NO_VENDOR)
    setStatus(choice?.status ?? "proposed")
    setError(null)
  }, [open, choice])

  const supplierOptions = React.useMemo(
    () => [{ value: NO_VENDOR, label: "Not in Compass (type the name)" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))],
    [suppliers],
  )

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const text = (name: string): string => String(data.get(name) ?? "")
    setError(null)
    startTransition(async () => {
      const result = await saveSelectionChoice(projectId, selectionId, choice?.id ?? null, {
        title: text("title"),
        description: text("description"),
        price: text("price"),
        ownerPrice: text("ownerPrice"),
        leadTimeDays: text("leadTimeDays"),
        vendorId: vendorId === NO_VENDOR ? null : vendorId,
        supplierName: vendorId === NO_VENDOR ? text("supplierName") : null,
        status,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{choice ? "Edit choice" : "Add choice"}</DialogTitle>
          <DialogDescription>Owners see the title, description, owner price, photos and links, never the supplier or the supplier price.</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-title`}>Title</Label>
            <Input id={`${formId}-title`} name="title" required maxLength={200} defaultValue={choice?.title ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-description`}>Description</Label>
            <Textarea id={`${formId}-description`} name="description" rows={2} maxLength={4000} defaultValue={choice?.description ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label>Supplier</Label>
            <SearchableCombobox
              ariaLabel="Supplier"
              value={vendorId}
              onValueChange={setVendorId}
              options={supplierOptions}
              placeholder="Choose a supplier"
              searchPlaceholder="Search suppliers…"
            />
            {vendorId === NO_VENDOR && (
              <Input name="supplierName" aria-label="Supplier name" placeholder="Supplier name" maxLength={200} defaultValue={choice?.supplierName ?? ""} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-price`}>Supplier price</Label>
              <Input id={`${formId}-price`} name="price" inputMode="decimal" placeholder="0.00" defaultValue={dollars(choice?.priceCents ?? null)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-owner-price`}>Owner price</Label>
              <Input id={`${formId}-owner-price`} name="ownerPrice" inputMode="decimal" placeholder="0.00" defaultValue={dollars(choice?.ownerPriceCents ?? null)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-lead`}>Lead time (days)</Label>
              <Input id={`${formId}-lead`} name="leadTimeDays" inputMode="numeric" defaultValue={choice?.leadTimeDays ?? ""} />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">Owner price is what the owner sees, including the builder fee.</p>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <SearchableCombobox
              ariaLabel="Choice status"
              value={status}
              onValueChange={(value) => {
                const next = SELECTION_CHOICE_STATUSES.find((item) => item === value)
                if (next) setStatus(next)
              }}
              options={SELECTION_CHOICE_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
              placeholder="Status"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : "Save choice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
