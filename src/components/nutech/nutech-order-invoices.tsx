"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  addNuTechOrderInvoiceAction,
  deleteNuTechOrderInvoiceAction,
  type NuTechOrderInvoice,
  type NuTechOrderInvoicesView,
} from "@/app/actions/nutech-order-invoices"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NUTECH_ORDER_INVOICE_KINDS, type NuTechOrderInvoiceKind } from "@/lib/domain/nutech/statuses"
import { nuTechShippingInputCents } from "@/lib/domain/nutech/rules"
import { formatCents, formatDate } from "@/lib/format"
import { DOCUMENT_INPUT_CLASS, DOCUMENT_SELECT_TRIGGER_CLASS } from "@/lib/ui/document-fields"
import { cn } from "@/lib/utils"

const KIND_LABELS: Readonly<Record<NuTechOrderInvoiceKind, string>> = {
  invoice: "Invoice",
  freight: "Freight invoice",
  credit_memo: "Credit memo",
}

/** Credit memos subtract; a missing amount counts as nothing. */
function signedCents(invoice: NuTechOrderInvoice): number {
  const cents = invoice.amountCents ?? 0
  return invoice.kind === "credit_memo" ? -cents : cents
}

/**
 * Every invoice and credit memo on an order: the manufacturer's (often
 * several per PO), the carrier's freight bill, and any credit memo. Sits
 * inside the order form, so its controls never submit that form.
 */
export function NuTechOrderInvoices({
  projectId,
  orderId,
  view,
  manufacturerName,
  canEdit,
}: {
  readonly projectId: string
  readonly orderId: string
  readonly view: NuTechOrderInvoicesView
  readonly manufacturerName: string
  readonly canEdit: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [vendorId, setVendorId] = React.useState("")
  const [kind, setKind] = React.useState<NuTechOrderInvoiceKind>("invoice")
  const [number, setNumber] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [receivedOn, setReceivedOn] = React.useState("")
  const manufacturer = manufacturerName.trim() || "Manufacturer"
  const hasAmounts = view.invoices.some((invoice) => invoice.amountCents !== null)
  const totalCents = view.invoices.reduce((total, invoice) => total + signedCents(invoice), 0)

  function add(): void {
    // Same dollars parser as the order's shipping charge ("$1,234.50" → 123450).
    const amountCents = amount.trim() === "" ? null : nuTechShippingInputCents(amount)
    startTransition(async () => {
      const result = await addNuTechOrderInvoiceAction(projectId, orderId, {
        vendorId: vendorId || null,
        kind,
        invoiceNumber: number,
        amountCents,
        receivedOn: receivedOn || null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${KIND_LABELS[kind]} ${number.trim()} added.`)
      setNumber("")
      setAmount("")
      router.refresh()
    })
  }

  function remove(invoice: NuTechOrderInvoice): void {
    if (!window.confirm(`Remove ${KIND_LABELS[invoice.kind].toLowerCase()} ${invoice.invoiceNumber} from this order?`)) return
    startTransition(async () => {
      const result = await deleteNuTechOrderInvoiceAction(projectId, orderId, invoice.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${invoice.invoiceNumber} removed.`)
      router.refresh()
    })
  }

  // Enter in these fields adds the invoice instead of saving the whole order form.
  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key !== "Enter") return
    event.preventDefault()
    if (number.trim()) add()
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Invoices on this order</p>
        <p className="mt-1 text-xs text-muted-foreground">
          One PO can carry several {manufacturer} invoices and credit memos; freight is its own invoice from the carrier.
          Whether they are paid comes from Sage.
        </p>
      </div>
      {view.invoices.length > 0 ? (
        <div className="overflow-x-auto border-y">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-2 py-2 font-medium">Number</th>
                <th className="px-2 py-2 font-medium">Kind</th>
                <th className="px-2 py-2 font-medium">Received</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-2 py-2">{invoice.vendorName ?? manufacturer}</td>
                  <td className="px-2 py-2 font-medium">{invoice.invoiceNumber}</td>
                  <td className="px-2 py-2 text-muted-foreground">{KIND_LABELS[invoice.kind]}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatDate(invoice.receivedOn, "medium", "—")}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", invoice.kind === "credit_memo" && "text-muted-foreground")}>
                    {invoice.amountCents === null ? "—" : formatCents(signedCents(invoice))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {canEdit ? (
                      <Button type="button" size="icon" variant="ghost" className="text-destructive hover:text-destructive"
                        disabled={pending} onClick={() => remove(invoice)}>
                        <IconTrash className="size-4" />
                        <span className="sr-only">Remove {invoice.invoiceNumber}</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            {hasAmounts ? (
              <tfoot className="border-t">
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground">Total less credit memos</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCents(totalCents)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      )}
      {canEdit ? (
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_10rem_9rem_8rem_9rem_auto] md:items-end" onKeyDown={onKeyDown}>
          <div className="space-y-2">
            <Label htmlFor="nutech-invoice-from">From</Label>
            <SearchableCombobox
              id="nutech-invoice-from"
              className={cn(DOCUMENT_SELECT_TRIGGER_CLASS, "h-9")}
              value={vendorId}
              onValueChange={setVendorId}
              options={[{ value: "", label: manufacturer }, ...view.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))]}
              ariaLabel="Invoice from"
              placeholder={manufacturer}
              searchPlaceholder="Search vendors..."
              emptyMessage="No matching vendors."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nutech-invoice-kind">Kind</Label>
            <Select value={kind} onValueChange={(value) => setKind(NUTECH_ORDER_INVOICE_KINDS.find((option) => option === value) ?? "invoice")}>
              <SelectTrigger id="nutech-invoice-kind" className={DOCUMENT_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUTECH_ORDER_INVOICE_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>{KIND_LABELS[option]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nutech-invoice-new-number">Number</Label>
            <Input className={DOCUMENT_INPUT_CLASS} id="nutech-invoice-new-number" value={number} placeholder="e.g. 258670-EPS"
              onChange={(event) => setNumber(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nutech-invoice-amount">Amount</Label>
            <Input className={DOCUMENT_INPUT_CLASS} id="nutech-invoice-amount" inputMode="decimal" value={amount} placeholder="Optional"
              onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nutech-invoice-received-on">Received</Label>
            <Input className={DOCUMENT_INPUT_CLASS} id="nutech-invoice-received-on" type="date" value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)} />
          </div>
          <Button type="button" disabled={pending || !number.trim()} onClick={add}>
            <IconPlus className="size-4" />
            Add
          </Button>
        </div>
      ) : null}
    </div>
  )
}
