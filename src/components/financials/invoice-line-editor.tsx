"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ReorderHandle, SortableRow, SortableRows } from "@/components/ui/sortable-rows"
import { effectivePriceMode, invoiceTotals, lineAmountCents, type InvoiceLineInput } from "@/lib/domain/financials/simple-invoice-rules"
import type { InvoiceCustomerType, InvoicePriceMode } from "@/lib/domain/financials/statuses"
import type { CatalogProductOption, EstimateLineForInvoice } from "@/lib/financials/simple-invoices-server"
import { formatCents, toCents } from "@/lib/format"
import { nuTechCustomerPriceCents } from "@/lib/nutech/catalog-pricing"
import { nuTechEstimateLineDescription } from "@/lib/nutech/estimate-wording"
import { moveLine } from "@/lib/shared/line-order"

/*
 * The one invoice line editor for both paths (from an estimate, and one-off
 * "New invoice"): estimate lines with what's left on each, price list items,
 * and typed lines. Every line's Taxable box stays editable (shipping is
 * usually not taxable). The preview uses the same rules the server applies
 * when it saves, so totals here match the saved invoice.
 */

export type EditorLine = InvoiceLineInput & { readonly key: string }

export function editorLine(line: InvoiceLineInput): EditorLine {
  return { ...line, key: crypto.randomUUID() }
}

type Pricing = {
  readonly squareRequested: boolean
  readonly priceMode: InvoicePriceMode
  readonly customerType: InvoiceCustomerType
}

function catalogPrice(product: CatalogProductOption, pricing: Pricing): number {
  return nuTechCustomerPriceCents(product.prices, pricing.customerType, effectivePriceMode(pricing))
}

function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function InvoiceLineEditor({
  lines,
  onChange,
  estimateLines,
  catalog,
  costCodes,
  pricing,
  taxRateBasisPoints,
  taxDistrictName,
}: {
  readonly lines: readonly EditorLine[]
  readonly onChange: (lines: readonly EditorLine[]) => void
  readonly estimateLines: readonly EstimateLineForInvoice[] | null
  readonly catalog: readonly CatalogProductOption[]
  readonly costCodes: readonly { readonly value: string; readonly label: string; readonly unlisted?: boolean }[]
  readonly pricing: Pricing
  readonly taxRateBasisPoints: number | null
  readonly taxDistrictName: string | null
}): React.ReactElement {
  const catalogById = React.useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog])
  const estimateById = React.useMemo(() => new Map((estimateLines ?? []).map((line) => [line.estimateLineId, line])), [estimateLines])
  const [pickEstimate, setPickEstimate] = React.useState("")
  const [pickProduct, setPickProduct] = React.useState("")

  // Catalog items show the price the server will charge (Square uses the regular price).
  const shown = lines.map((line): EditorLine => {
    const product = line.nutechProductId ? catalogById.get(line.nutechProductId) : undefined
    if (!product) return line
    if (line.source === "estimate" && !(pricing.squareRequested && pricing.priceMode === "cash_discount")) return line
    return { ...line, unitPriceCents: catalogPrice(product, pricing) }
  })
  const totals = invoiceTotals(
    shown.map((line) => ({ ...line, amountCents: lineAmountCents(line.quantity, line.unitPriceCents) })),
    taxRateBasisPoints
  )

  function update(key: string, patch: Partial<InvoiceLineInput>): void {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function addEstimateLine(id: string): void {
    const line = estimateById.get(id)
    if (!line) return
    onChange([
      ...lines,
      editorLine({
        source: "estimate",
        estimateLineId: line.estimateLineId,
        nutechProductId: line.nutechProductId,
        costCode: line.costCode,
        description: line.description,
        quantity: line.remainingQuantity > 0 ? line.remainingQuantity : line.quantity,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        taxable: line.taxable,
      }),
    ])
    setPickEstimate("")
  }

  function addProduct(id: string): void {
    const product = catalogById.get(id)
    if (!product) return
    onChange([
      ...lines,
      editorLine({
        source: "added",
        estimateLineId: null,
        nutechProductId: product.id,
        costCode: product.costCode ?? "",
        description: nuTechEstimateLineDescription({ quantity: 1, unit: product.unit, name: product.name, sku: product.sku, packageLabel: product.packageLabel }),
        quantity: 1,
        unit: product.unit,
        unitPriceCents: catalogPrice(product, pricing),
        taxable: product.taxable,
      }),
    ])
    setPickProduct("")
  }

  function addTypedLine(): void {
    onChange([
      ...lines,
      editorLine({ source: "added", estimateLineId: null, nutechProductId: null, costCode: "", description: "", quantity: 1, unit: "EA", unitPriceCents: 0, taxable: false }),
    ])
  }

  const estimateOptions = (estimateLines ?? []).map((line) => ({
    value: line.estimateLineId,
    label: line.description,
    description: `${line.costCode} · ${formatCents(line.remainingCents)} left of ${formatCents(line.sellCents)}`,
  }))
  const productOptions = catalog.map((product) => ({
    value: product.id,
    label: `${product.name} (${product.sku})`,
    description: `${formatCents(catalogPrice(product, pricing))} / ${product.unit}`,
    keywords: product.sku,
  }))

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[2.75rem_minmax(0,2.4fr)_minmax(0,1.3fr)_5.5rem_4.5rem_7rem_4.5rem_7rem_2.5rem] gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
            <span />
            <span>Description</span>
            <span>Cost code</span>
            <span className="text-right">Qty</span>
            <span>Unit</span>
            <span className="text-right">Unit price</span>
            <span className="text-center">Taxable</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <SortableRows ids={lines.map((line) => line.key)} onMove={(from, to) => onChange(moveLine(lines, from, to))}>
            {shown.map((line, index) => {
              const estimate = line.estimateLineId ? estimateById.get(line.estimateLineId) : undefined
              const priceListed = Boolean(line.nutechProductId && catalogById.has(line.nutechProductId)) && (line.source === "added" || (pricing.squareRequested && pricing.priceMode === "cash_discount"))
              const original = lines[index]
              if (!original) return null
              return (
                <SortableRow
                  key={line.key}
                  id={line.key}
                  index={index}
                  className="grid grid-cols-[2.75rem_minmax(0,2.4fr)_minmax(0,1.3fr)_5.5rem_4.5rem_7rem_4.5rem_7rem_2.5rem] items-start gap-2 border-b bg-background py-2"
                >
                  <div className="pl-1 pt-1">
                    <ReorderHandle label={line.description || `Line ${index + 1}`} />
                  </div>
                  <div className="space-y-1">
                    <Input aria-label={`Line ${index + 1} description`} value={original.description} onChange={(event) => update(line.key, { description: event.target.value })} />
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {line.source === "added" && estimateLines ? <Badge variant="outline">Added (not on estimate)</Badge> : null}
                      {estimate ? <span>Estimate: {estimate.quantity} {estimate.unit}, {formatCents(estimate.invoicedCents)} invoiced before</span> : null}
                      {priceListed ? <span>Price list{pricing.squareRequested ? " (regular price for Square)" : ""}</span> : null}
                    </div>
                  </div>
                  <SearchableCombobox
                    ariaLabel={`Line ${index + 1} cost code`}
                    options={costCodes}
                    value={line.costCode}
                    onValueChange={(value) => update(line.key, { costCode: value })}
                    placeholder="Cost code"
                    searchPlaceholder="Search cost codes..."
                  />
                  <Input
                    aria-label={`Line ${index + 1} quantity`}
                    type="number"
                    step="any"
                    className="text-right"
                    value={String(original.quantity)}
                    onChange={(event) => update(line.key, { quantity: Number(event.target.value) })}
                  />
                  <Input aria-label={`Line ${index + 1} unit`} value={original.unit} onChange={(event) => update(line.key, { unit: event.target.value })} />
                  <MoneyInput
                    label={`Line ${index + 1} unit price`}
                    cents={line.unitPriceCents}
                    disabled={priceListed}
                    onChange={(cents) => update(line.key, { unitPriceCents: cents })}
                  />
                  <div className="flex justify-center pt-2">
                    <Checkbox aria-label={`Line ${index + 1} taxable`} checked={original.taxable} onCheckedChange={(checked) => update(line.key, { taxable: checked === true })} />
                  </div>
                  <span className="pt-2 text-right tabular-nums">{formatCents(lineAmountCents(line.quantity, line.unitPriceCents))}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${index + 1}`} onClick={() => onChange(lines.filter((item) => item.key !== line.key))}>
                    <IconTrash className="size-4" aria-hidden />
                  </Button>
                </SortableRow>
              )
            })}
          </SortableRows>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {estimateLines && estimateLines.length > 0 && (
          <SearchableCombobox
            ariaLabel="Add a line from the estimate"
            options={estimateOptions}
            value={pickEstimate}
            onValueChange={addEstimateLine}
            placeholder="Add from estimate…"
            searchPlaceholder="Search estimate lines..."
            className="w-full sm:w-72"
          />
        )}
        {catalog.length > 0 && (
          <SearchableCombobox
            ariaLabel="Add an item from the price list"
            options={productOptions}
            value={pickProduct}
            onValueChange={addProduct}
            placeholder="Add from price list…"
            searchPlaceholder="Search products..."
            className="w-full sm:w-72"
          />
        )}
        <Button type="button" variant="outline" size="sm" onClick={addTypedLine}>
          <IconPlus className="size-4" aria-hidden />
          Add line
        </Button>
      </div>

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatCents(totals.subtotalCents)}</dd>
        <dt className="text-muted-foreground">Sales tax{taxDistrictName ? ` (${taxDistrictName})` : ""}</dt>
        <dd className="text-right tabular-nums">{formatCents(totals.taxCents)}</dd>
        <dt className="font-medium">Total</dt>
        <dd className="text-right font-medium tabular-nums">{formatCents(totals.totalCents)}</dd>
      </dl>
    </div>
  )
}

/** Dollars typed, cents stored; keeps what the person types until they leave the field. */
function MoneyInput({ label, cents, disabled, onChange }: { readonly label: string; readonly cents: number; readonly disabled: boolean; readonly onChange: (cents: number) => void }): React.ReactElement {
  const [text, setText] = React.useState(dollarsText(cents))
  const [editing, setEditing] = React.useState(false)
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="text-right"
      disabled={disabled}
      value={editing ? text : dollarsText(cents)}
      onFocus={() => {
        setText(dollarsText(cents))
        setEditing(true)
      }}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = toCents(event.target.value.replace(/[$,]/g, ""))
        if (parsed !== null) onChange(parsed)
      }}
      onBlur={() => setEditing(false)}
    />
  )
}
