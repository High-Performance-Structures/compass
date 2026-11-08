"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconCheck, IconDeviceFloppy, IconPrinter, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { deleteProjectInvoice, finalizeProjectInvoice, saveProjectInvoiceDraft } from "@/app/actions/project-invoices"
import type { ProjectInvoiceEditor } from "@/app/actions/project-invoice-views"
import { InvoiceLineEditor, editorLine, type EditorLine } from "@/components/financials/invoice-line-editor"
import { InvoiceSendPanel } from "@/components/financials/invoice-send-panel"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { InvoiceCustomerType, InvoicePriceMode } from "@/lib/domain/financials/statuses"
import { formatCents, formatDate } from "@/lib/format"
import { printPreviewHref } from "@/lib/print/print-documents"

/*
 * One invoice: the draft editor (bill to, dates, tax district, deposit,
 * price list, Create Square invoice, and the shared line editor), then, once
 * final, Sage, email and Square in the send panel. Drafts can be deleted;
 * anything that went out is voided instead.
 */

const STATUS_LABEL: Readonly<Record<string, string>> = { draft: "Draft", open: "Open", partially_paid: "Partly paid", paid: "Paid", void: "Void" }

type Draft = {
  customerId: string
  invoiceKind: "nutech_sale" | "other"
  title: string
  memo: string
  issueDate: string
  dueDate: string
  taxEntityId: string
  isDeposit: boolean
  priceMode: InvoicePriceMode
  priceCustomerType: InvoiceCustomerType
  squareRequested: boolean
}

export function InvoiceWorkspace({ editor }: { readonly editor: ProjectInvoiceEditor }): React.ReactElement {
  const router = useRouter()
  const { invoice, project } = editor
  const [draft, setDraft] = React.useState<Draft>({
    customerId: invoice.customerId,
    invoiceKind: invoice.invoiceKind,
    title: invoice.title ?? "",
    memo: invoice.memo ?? "",
    issueDate: invoice.issueDate.slice(0, 10),
    dueDate: (invoice.dueDate ?? invoice.issueDate).slice(0, 10),
    taxEntityId: invoice.taxEntityId ?? "",
    isDeposit: invoice.isDeposit,
    priceMode: invoice.priceMode,
    priceCustomerType: invoice.priceCustomerType,
    squareRequested: invoice.squareRequested,
  })
  const [lines, setLines] = React.useState<readonly EditorLine[]>(() => invoice.lines.map(editorLine))
  const [dirty, setDirty] = React.useState(false)
  const [overEstimate, setOverEstimate] = React.useState<readonly string[] | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const editable = editor.actions.canEdit
  const district = editor.taxDistricts.find((option) => option.id === draft.taxEntityId) ?? null
  const showPriceList = editor.catalog.length > 0 && lines.some((line) => line.nutechProductId)

  function change(patch: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  function save(allowOverEstimate: boolean, then?: () => void): void {
    startTransition(async () => {
      const result = await saveProjectInvoiceDraft(project.id, invoice.id, {
        expectedUpdatedAt: invoice.updatedAt,
        ...draft,
        taxEntityId: draft.taxEntityId || null,
        lines: lines.map((line) => ({ source: line.source, estimateLineId: line.estimateLineId, nutechProductId: line.nutechProductId, costCode: line.costCode, description: line.description, quantity: line.quantity, unit: line.unit, unitPriceCents: line.unitPriceCents, taxable: line.taxable })),
        allowOverEstimate,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.kind === "over_estimate") {
        setOverEstimate(result.data.warnings)
        return
      }
      setOverEstimate(null)
      setDirty(false)
      toast.success(`Draft saved (${formatCents(result.data.totalCents)}).`)
      router.refresh()
      then?.()
    })
  }

  function finalize(): void {
    startTransition(async () => {
      const result = await finalizeProjectInvoice(project.id, invoice.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Invoice ${result.data.invoiceNumber} is final. Send it to Sage, then email it.`)
      router.refresh()
    })
  }

  function remove(): void {
    startTransition(async () => {
      const result = await deleteProjectInvoice(project.id, invoice.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Draft invoice deleted.")
      router.push(`/dashboard/projects/${project.id}/financials`)
    })
  }

  const customerOptions = editor.customers.map((customer) => ({ value: customer.id, label: customer.name, description: customer.email ?? undefined }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Draft invoice"}</h1>
          <RecordStatusBadge label={STATUS_LABEL[invoice.status] ?? invoice.status} color={invoice.status === "paid" ? "green" : invoice.status === "draft" || invoice.status === "void" ? "gray" : "blue"} />
          {editor.estimate && <span className="text-sm text-muted-foreground">From estimate {editor.estimate.label}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={printPreviewHref({ projectId: project.id, document: "invoice", params: { invoiceId: invoice.id }, number: invoice.invoiceNumber ?? "Draft invoice" })} target="_blank">
              <IconPrinter className="size-4" aria-hidden />
              Print Preview
            </Link>
          </Button>
          {editor.actions.canDelete && (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              <IconTrash className="size-4" aria-hidden />
              Delete draft
            </Button>
          )}
        </div>
      </div>
      {invoice.status === "void" && (
        <p className="text-sm text-destructive">Void {invoice.voidedAt ? formatDate(invoice.voidedAt) : ""}: {invoice.voidReason}</p>
      )}

      <section aria-label="Invoice details" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="invoice-bill-to">Bill to</Label>
          <SearchableCombobox id="invoice-bill-to" ariaLabel="Bill to" options={customerOptions} value={draft.customerId} onValueChange={(value) => change({ customerId: value })} placeholder="Choose the customer" disabled={!editable} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-title">Description (Sage, 50 characters)</Label>
          <Input id="invoice-title" maxLength={50} value={draft.title} disabled={!editable} onChange={(event) => change({ title: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-kind">Numbering</Label>
          <Select value={draft.invoiceKind} disabled={!editable || invoice.sequenceNumber !== null} onValueChange={(value) => change({ invoiceKind: value === "nutech_sale" ? "nutech_sale" : "other" })}>
            <SelectTrigger id="invoice-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nutech_sale">Material sale (S01, S02…)</SelectItem>
              <SelectItem value="other">Other billing (INV01, INV02…)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-date">Invoice date</Label>
          <Input id="invoice-date" type="date" value={draft.issueDate} disabled={!editable} onChange={(event) => change({ issueDate: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-due">Due date</Label>
          <Input id="invoice-due" type="date" value={draft.dueDate} disabled={!editable} onChange={(event) => change({ dueDate: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-tax">Sales tax district</Label>
          <SearchableCombobox
            id="invoice-tax"
            ariaLabel="Sales tax district"
            options={[{ value: "", label: "No sales tax district" }, ...editor.taxDistricts.map((option) => ({ value: option.id, label: option.name, description: `${(option.rateBasisPoints / 100).toFixed(2)}% · ${option.code}` }))]}
            value={draft.taxEntityId}
            onValueChange={(value) => change({ taxEntityId: value })}
            placeholder="Choose the job's tax district"
            disabled={!editable}
          />
        </div>
        {showPriceList && (
          <div className="space-y-1.5">
            <Label htmlFor="invoice-price-list">Price list</Label>
            <Select
              value={`${draft.priceCustomerType}:${draft.priceMode}`}
              disabled={!editable}
              onValueChange={(value) => {
                const [customer, mode] = value.split(":")
                change({ priceCustomerType: customer === "new" ? "new" : "returning", priceMode: mode === "cash_discount" ? "cash_discount" : "standard" })
              }}
            >
              <SelectTrigger id="invoice-price-list" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="returning:standard">Returning customer, regular price</SelectItem>
                <SelectItem value="returning:cash_discount">Returning customer, cash/check price</SelectItem>
                <SelectItem value="new:standard">New customer, regular price</SelectItem>
                <SelectItem value="new:cash_discount">New customer, cash/check price</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2 md:col-span-2 lg:col-span-1">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={draft.isDeposit} disabled={!editable} onCheckedChange={(checked) => change({ isDeposit: checked === true, squareRequested: checked === true && !editor.square.allowed ? false : draft.squareRequested })} />
            This is a deposit invoice
          </Label>
          <Label className="flex items-start gap-2 font-normal">
            <Checkbox
              className="mt-0.5"
              checked={draft.squareRequested}
              disabled={!editable || (draft.isDeposit && !editor.square.allowed)}
              onCheckedChange={(checked) => change({ squareRequested: checked === true })}
            />
            <span>
              Create Square invoice
              <span className="block text-xs text-muted-foreground">
                {draft.isDeposit && !editor.square.allowed
                  ? editor.square.reason
                  : !editor.square.connected
                    ? "Square not connected for invoices."
                    : "Square sends nothing; Compass emails the PDF with the payment link. Material sales use the regular price on Square."}
              </span>
            </span>
          </Label>
        </div>
        <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
          <Label htmlFor="invoice-memo">Note on the invoice</Label>
          <Textarea id="invoice-memo" rows={2} value={draft.memo} disabled={!editable} onChange={(event) => change({ memo: event.target.value })} />
        </div>
      </section>

      <section aria-label="Invoice lines" className="space-y-2">
        <h2 className="text-sm font-semibold">Lines</h2>
        {editable ? (
          <InvoiceLineEditor
            lines={lines}
            onChange={(next) => {
              setLines(next)
              setDirty(true)
            }}
            estimateLines={editor.estimate?.lines ?? null}
            catalog={editor.catalog}
            costCodes={editor.costCodes}
            pricing={{ squareRequested: draft.squareRequested, priceMode: draft.priceMode, customerType: draft.priceCustomerType }}
            taxRateBasisPoints={district?.rateBasisPoints ?? null}
            taxDistrictName={district?.name ?? null}
          />
        ) : (
          <InvoiceLinesReadOnly editor={editor} />
        )}
      </section>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
            <IconDeviceFloppy className="size-4" aria-hidden />
            Save draft
          </Button>
          <Button type="button" disabled={pending || dirty || !editor.actions.canFinalize} onClick={finalize} title={dirty ? "Save the draft first." : undefined}>
            <IconCheck className="size-4" aria-hidden />
            Finalize
          </Button>
          <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes." : "Finalize gives the invoice its number; then send it to Sage and email it."}</span>
        </div>
      )}

      {!editable && <InvoiceSendPanel editor={editor} />}

      <AlertDialog open={overEstimate !== null} onOpenChange={(open) => (!open ? setOverEstimate(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bill more than the estimate?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>These lines go over what the estimate has left. Lines added on the invoice don&apos;t count.</p>
                <ul className="list-disc space-y-1 pl-5">
                  {(overEstimate ?? []).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => save(true)}>Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft invoice?</AlertDialogTitle>
            <AlertDialogDescription>The draft and its lines are removed. It never went to Sage, Square or the customer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InvoiceLinesReadOnly({ editor }: { readonly editor: ProjectInvoiceEditor }): React.ReactElement {
  const { invoice } = editor
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="border-b py-1 pr-2 font-medium">Description</th>
            <th className="border-b py-1 pr-2 font-medium">Cost code</th>
            <th className="border-b py-1 pr-2 text-right font-medium">Qty</th>
            <th className="border-b py-1 pr-2 text-right font-medium">Unit price</th>
            <th className="border-b py-1 pr-2 text-center font-medium">Taxable</th>
            <th className="border-b py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className="border-b py-1 pr-2 align-top">
                {line.description}
                {line.source === "added" && editor.estimate ? <span className="ml-2 text-xs text-muted-foreground">Added (not on estimate)</span> : null}
              </td>
              <td className="border-b py-1 pr-2 align-top">{line.costCode}</td>
              <td className="border-b py-1 pr-2 text-right align-top tabular-nums">
                {line.quantity} {line.unit}
              </td>
              <td className="border-b py-1 pr-2 text-right align-top tabular-nums">{formatCents(line.unitPriceCents)}</td>
              <td className="border-b py-1 pr-2 text-center align-top">{line.taxable ? "Yes" : "No"}</td>
              <td className="border-b py-1 text-right align-top tabular-nums">{formatCents(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="py-1 text-right text-muted-foreground">Subtotal</td>
            <td className="py-1 text-right tabular-nums">{formatCents(invoice.subtotalCents)}</td>
          </tr>
          <tr>
            <td colSpan={5} className="py-1 text-right text-muted-foreground">Sales tax</td>
            <td className="py-1 text-right tabular-nums">{formatCents(invoice.taxCents)}</td>
          </tr>
          <tr>
            <td colSpan={5} className="py-1 text-right font-medium">Total</td>
            <td className="py-1 text-right font-medium tabular-nums">{formatCents(invoice.totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
