import type { GoogleSheetValueUpdate } from "@/lib/google/client/sheets-client"

/**
 * Fills the manufacturer's order form (Fox Blocks "US Level 3 Stocking
 * Dealer", sheet USLvl3) the way staff fill it by hand. Item rows and the
 * Misc row are found by reading the form, so a new form revision with
 * different rows still fills correctly. Quantities and unit costs go in
 * columns A and I; the form's own formulas compute bundles, line totals,
 * subtotals and the order total, so those cells are never overwritten.
 */

const SHEET = "USLvl3"

export type NuTechAirliteOrderLine = {
  readonly manufacturerSku: string
  readonly name: string
  readonly origin: string
  readonly quantity: number
  readonly minimumOrderIncrement: number
  readonly packageLabel: string
  readonly priceUnit: string
  readonly unitCostCents: number
}

export type NuTechAirliteFormLayout = {
  /** Item # (normalized) → sheet row. */
  readonly itemRows: ReadonlyMap<string, number>
  /** Row of "Misc Order info"; its note goes in G of that row. */
  readonly miscRow: number | null
}

export type NuTechAirliteWorkbookPlan = {
  readonly updates: readonly GoogleSheetValueUpdate[]
  readonly addendumItemCount: number
  readonly totalCostCents: number
  readonly addendumValues: ReadonlyArray<ReadonlyArray<unknown>>
}

export type NuTechAirliteOrderHeader = {
  /** "1859 Reeves": the PO number and the client's last name. */
  readonly purchaseOrderLabel: string
  /** Shown as M/D/YYYY. */
  readonly purchaseOrderDate: string
  readonly fulfillment: "delivery" | "pickup"
  readonly requestedDate: string | null
  /** e.g. "1000 (CSC Rate)"; deliveries only. */
  readonly freight: string | null
  readonly fob: string | null
  readonly shippingWarehouse: string | null
  /** Delivery address: street, then city/state/ZIP. */
  readonly shipToLines: readonly string[]
  readonly deliveryContact: string | null
  readonly miscNote: string | null
}

/** Compares item numbers ignoring case, spaces and hyphens ("Fox Spray Foam" = "FOX-SPRAYFOAM"). */
export function normalizeAirliteSku(sku: string): string {
  return sku.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
}

/** Reads the item rows from the form's values (row 1 first, columns A–J). */
export function readNuTechAirliteFormLayout(values: ReadonlyArray<ReadonlyArray<unknown>>): NuTechAirliteFormLayout {
  const headerIndex = values.findIndex((row) => text(row[0]).toLowerCase().startsWith("enter each qty"))
  if (headerIndex < 0) throw new Error("The order form has no \"Enter Each Qty.\" header row; check the form in Settings.")
  const itemRows = new Map<string, number>()
  let miscRow: number | null = null
  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] ?? []
    if (text(row[0]).toLowerCase().startsWith("misc order info")) {
      miscRow = index + 1
      break
    }
    const sku = text(row[1])
    // Subtotal and total rows carry a label in G–I and no item number.
    if (!sku) continue
    // Some rows name the item in B and put the item number in the description ("Fox-Spraygun").
    const descriptionSku = /^fox-\S+/i.exec(text(row[3]))?.[0]
    for (const key of [sku, descriptionSku]) {
      if (key && !itemRows.has(normalizeAirliteSku(key))) itemRows.set(normalizeAirliteSku(key), index + 1)
    }
  }
  if (itemRows.size === 0) throw new Error("No item rows were found on the order form.")
  return { itemRows, miscRow }
}

function cell(range: string, value: unknown): GoogleSheetValueUpdate {
  return { range: `${SHEET}!${range}`, values: [[value]] }
}

export function formatAirliteDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-")
  return year && month && day ? `${Number(month)}/${Number(day)}/${year}` : isoDate
}

export function buildNuTechAirliteWorkbookPlan(input: {
  readonly layout: NuTechAirliteFormLayout
  readonly header: NuTechAirliteOrderHeader
  readonly lines: readonly NuTechAirliteOrderLine[]
}): NuTechAirliteWorkbookPlan {
  const { layout, header } = input
  if (input.lines.length === 0) {
    throw new Error("Add at least one Nu-Tech catalog item before generating the Airlite workbook.")
  }
  const invalidLine = input.lines.find(
    (line) => !Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity % line.minimumOrderIncrement !== 0
  )
  if (invalidLine) {
    throw new Error(`${invalidLine.manufacturerSku} quantity must be a positive multiple of ${invalidLine.minimumOrderIncrement}.`)
  }
  const delivery = header.fulfillment === "delivery"
  const updates: GoogleSheetValueUpdate[] = [
    cell("B7", header.purchaseOrderLabel),
    cell("B8", header.purchaseOrderDate),
    cell("E6", delivery ? (header.freight ?? "") : ""),
    cell("E7", header.fob ?? ""),
    cell("E8", delivery ? "Delivery" : "CPU"),
    // Pickups ask for a ship date; deliveries an arrival date (ASAP when none).
    cell("I7", delivery ? "" : (header.requestedDate ?? "")),
    cell("I8", delivery ? (header.requestedDate ?? "ASAP") : ""),
    cell("I9", header.shippingWarehouse ?? ""),
    cell("G13", delivery ? (header.shipToLines[0] ?? "") : ""),
    cell("G14", delivery ? header.shipToLines.slice(1).join(", ") : ""),
    cell("I19", delivery ? (header.deliveryContact ?? "") : `CPU ${header.deliveryContact ?? ""}`.trim()),
  ]

  const ordered = new Map<number, NuTechAirliteOrderLine>()
  const addendumLines: NuTechAirliteOrderLine[] = []
  for (const line of input.lines) {
    const row = layout.itemRows.get(normalizeAirliteSku(line.manufacturerSku))
    if (row === undefined || ordered.has(row)) addendumLines.push(line)
    else ordered.set(row, line)
  }
  // Every item row is written, so a form copied from an earlier PO starts clean.
  for (const row of layout.itemRows.values()) {
    const line = ordered.get(row)
    updates.push(cell(`A${row}`, line ? line.quantity : ""))
    if (line) updates.push(cell(`I${row}`, line.unitCostCents / 100))
  }

  const lineTotal = (line: NuTechAirliteOrderLine): number => line.quantity * line.unitCostCents
  const totalCostCents = input.lines.reduce((sum, line) => sum + lineTotal(line), 0)
  const addendumCents = addendumLines.reduce((sum, line) => sum + lineTotal(line), 0)
  const notes = [
    header.miscNote,
    addendumLines.length > 0
      ? `Also ordering ${addendumLines.length} item(s) not on this form, listed on the Compass Addendum tab ($${(addendumCents / 100).toFixed(2)}, not in the totals above).`
      : null,
  ].filter((note): note is string => Boolean(note))
  if (layout.miscRow !== null) updates.push(cell(`G${layout.miscRow}`, notes.join(" ")))
  // The signature date beside the customer signature line.
  if (layout.miscRow !== null) updates.push(cell(`I${layout.miscRow + 2}`, header.purchaseOrderDate))

  const addendumValues: ReadonlyArray<ReadonlyArray<unknown>> =
    addendumLines.length === 0
      ? []
      : [
          ["Compass Airlite Order Addendum"],
          [header.purchaseOrderLabel, header.purchaseOrderDate],
          ["Items not listed on the USLvl3 form."],
          ["SKU", "Product", "Origin", "Quantity", "Price unit", "Package", "Airlite unit cost", "Line total"],
          ...addendumLines.map((line) => [
            line.manufacturerSku,
            line.name,
            line.origin,
            line.quantity,
            line.priceUnit,
            line.packageLabel,
            line.unitCostCents / 100,
            lineTotal(line) / 100,
          ]),
          [],
          ["Addendum total", "", "", "", "", "", "", addendumCents / 100],
        ]
  return { updates, addendumItemCount: addendumLines.length, totalCostCents, addendumValues }
}
