import type { GoogleSheetValueUpdate } from "@/lib/google/client/sheets-client"

export type NuTechAirliteOrderLine = {
  readonly manufacturerSku: string
  readonly name: string
  readonly origin: string
  readonly category: string
  readonly quantity: number
  readonly minimumOrderIncrement: number
  readonly packageLabel: string
  readonly priceUnit: string
  readonly airliteTemplateRow: number | null
  readonly unitCostCents: number
}

export type NuTechAirliteWorkbookPlan = {
  readonly updates: readonly GoogleSheetValueUpdate[]
  readonly addendumItemCount: number
  readonly totalCostCents: number
  readonly addendumValues: ReadonlyArray<ReadonlyArray<unknown>>
}

function cell(range: string, value: unknown): GoogleSheetValueUpdate {
  return { range: `USLvl3!${range}`, values: [[value]] }
}

function lineTotalCents(line: NuTechAirliteOrderLine): number {
  return line.quantity * line.unitCostCents
}

function packageCount(line: NuTechAirliteOrderLine): number {
  return line.quantity / line.minimumOrderIncrement
}

export function buildNuTechAirliteWorkbookPlan(input: {
  readonly purchaseOrderNumber: string
  readonly purchaseOrderDate: string
  readonly requestedDeliveryDate: string | null
  readonly projectName: string
  readonly jobsiteAddress: string | null
  readonly orderContactName: string
  readonly orderContactPhone: string | null
  readonly orderContactEmail: string
  readonly deliveryContact: string | null
  readonly lines: readonly NuTechAirliteOrderLine[]
}): NuTechAirliteWorkbookPlan {
  if (input.lines.length === 0) {
    throw new Error("Add at least one Nu-Tech catalog item before generating the Airlite workbook.")
  }
  const invalidLine = input.lines.find(
    (line) =>
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity % line.minimumOrderIncrement !== 0
  )
  if (invalidLine) {
    throw new Error(
      `${invalidLine.manufacturerSku} quantity must be a positive multiple of ${invalidLine.minimumOrderIncrement}.`
    )
  }
  const mappedLines = input.lines.filter(
    (line) => line.airliteTemplateRow !== null
  )
  const addendumLines = input.lines.filter(
    (line) => line.airliteTemplateRow === null
  )
  const updates: GoogleSheetValueUpdate[] = [
    cell("B7", input.purchaseOrderNumber),
    cell("B8", input.purchaseOrderDate),
    cell("H8", input.requestedDeliveryDate ?? ""),
    cell("H11", input.projectName),
    cell("H12", input.jobsiteAddress ?? ""),
    cell("B15", input.orderContactName),
    cell("B16", input.orderContactPhone ?? ""),
    cell("B18", input.orderContactEmail),
    cell("H19", input.deliveryContact ?? ""),
  ]
  for (const line of mappedLines) {
    const row = line.airliteTemplateRow
    if (row === null) continue
    updates.push(
      cell(`A${row}`, line.quantity),
      cell(`H${row}`, packageCount(line)),
      cell(`I${row}`, line.unitCostCents / 100),
      cell(`J${row}`, lineTotalCents(line) / 100)
    )
  }
  const blockLines = mappedLines.filter((line) => line.category === "block")
  const accessoryLines = mappedLines.filter((line) => line.category !== "block")
  const totalQuantity = input.lines.reduce((sum, line) => sum + line.quantity, 0)
  const totalPackages = input.lines.reduce(
    (sum, line) => sum + packageCount(line),
    0
  )
  const totalCostCents = input.lines.reduce(
    (sum, line) => sum + lineTotalCents(line),
    0
  )
  updates.push(
    cell("A68", blockLines.reduce((sum, line) => sum + line.quantity, 0)),
    cell("H68", blockLines.reduce((sum, line) => sum + packageCount(line), 0)),
    cell(
      "J68",
      blockLines.reduce((sum, line) => sum + lineTotalCents(line), 0) / 100
    ),
    cell("A85", accessoryLines.reduce((sum, line) => sum + line.quantity, 0)),
    cell(
      "H85",
      accessoryLines.reduce((sum, line) => sum + packageCount(line), 0)
    ),
    cell(
      "J85",
      accessoryLines.reduce((sum, line) => sum + lineTotalCents(line), 0) / 100
    ),
    cell("A87", totalQuantity),
    cell("H87", totalPackages),
    cell("J87", totalCostCents / 100),
    cell(
      "A94",
      addendumLines.length === 0
        ? ""
        : "See the Compass Addendum tab for products not listed on this manufacturer form. Addendum items are included in Order Sub-total."
    )
  )
  const addendumValues: ReadonlyArray<ReadonlyArray<unknown>> =
    addendumLines.length === 0
      ? []
      : [
          ["Compass Airlite Order Addendum"],
          [input.purchaseOrderNumber, input.projectName, input.purchaseOrderDate],
          ["Items below are included in the USLvl3 Order Sub-total."],
          [
            "SKU",
            "Product",
            "Origin",
            "Quantity",
            "Price unit",
            "Package",
            "Airlite unit cost",
            "Line total",
          ],
          ...addendumLines.map((line) => [
            line.manufacturerSku,
            line.name,
            line.origin,
            line.quantity,
            line.priceUnit,
            line.packageLabel,
            line.unitCostCents / 100,
            lineTotalCents(line) / 100,
          ]),
          [],
          ["Addendum total", "", "", "", "", "", "", addendumLines.reduce(
            (sum, line) => sum + lineTotalCents(line),
            0
          ) / 100],
        ]
  return {
    updates,
    addendumItemCount: addendumLines.length,
    totalCostCents,
    addendumValues,
  }
}
