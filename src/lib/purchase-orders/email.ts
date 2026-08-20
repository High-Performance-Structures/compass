export type PurchaseOrderEmailLine = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly quantity: number
  readonly unit: string | null
  readonly unitCost: number
  readonly amount: number
}

export type PurchaseOrderEmailInput = {
  readonly projectName: string
  readonly projectNumber: string | null
  readonly senderName: string
  readonly message: string
  readonly deliveryLocation: string | null
  readonly order: {
    readonly sourceRecordNumber: string | null
    readonly companyName: string | null
    readonly sageOrderDate: string | null
    readonly dueDate: string | null
    readonly amount: number | null
    readonly lines: readonly PurchaseOrderEmailLine[]
  }
}

function formatMoney(value: number | null): string {
  if (value === null) return "Amount TBD"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function formatEmailDate(value: string | null): string {
  if (!value) return "Not specified"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function purchaseOrderEmailText(
  input: PurchaseOrderEmailInput
): string {
  const lines = input.order.lines.map((line) =>
    [
      `${line.lineNumber}. ${line.description}`,
      `Phase: ${line.phaseCode ?? "-"}`,
      `Cost Code: ${line.costCode ?? "-"}`,
      `Qty: ${line.quantity} ${line.unit ?? ""}`.trim(),
      `Unit Cost: ${formatMoney(line.unitCost)}`,
      `Amount: ${formatMoney(line.amount)}`,
    ].join(" | ")
  )

  return [
    input.message,
    "",
    "Purchase Order",
    `P.O.: ${input.order.sourceRecordNumber ?? "Unnumbered"}`,
    `Project: ${input.projectNumber ? `${input.projectNumber} - ` : ""}${input.projectName}`,
    `Vendor: ${input.order.companyName ?? "Vendor TBD"}`,
    `Order Date: ${formatEmailDate(input.order.sageOrderDate)}`,
    `Required By: ${formatEmailDate(input.order.dueDate)}`,
    `Delivery Location: ${input.deliveryLocation ?? "TBD"}`,
    "",
    "Line Items",
    ...lines,
    "",
    `Total: ${formatMoney(input.order.amount)}`,
    "",
    `Sent through Compass by ${input.senderName}.`,
  ].join("\n")
}

export function purchaseOrderEmailHtml(
  input: PurchaseOrderEmailInput
): string {
  const projectLabel = `${input.projectNumber ? `${input.projectNumber} - ` : ""}${input.projectName}`
  const deliveryLocation = escapeHtml(
    input.deliveryLocation ?? "TBD"
  ).replaceAll("\n", "<br>")
  const rows = input.order.lines
    .map(
      (line) => `
        <tr>
          <td>${line.lineNumber}</td>
          <td>${escapeHtml(line.description)}</td>
          <td>${escapeHtml(line.phaseCode ?? "-")}</td>
          <td>${escapeHtml(line.costCode ?? "-")}</td>
          <td style="text-align:right;">${line.quantity}</td>
          <td>${escapeHtml(line.unit ?? "-")}</td>
          <td style="text-align:right;">${formatMoney(line.unitCost)}</td>
          <td style="text-align:right;font-weight:600;">${formatMoney(line.amount)}</td>
        </tr>`
    )
    .join("")

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.45;">
      <p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>
      <h2 style="margin-top:24px;margin-bottom:4px;">Purchase Order</h2>
      <p style="margin:0 0 16px 0;color:#4b5563;">
        ${escapeHtml(input.order.sourceRecordNumber ?? "Unnumbered")}
      </p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px;">
        <tbody>
          <tr><td style="font-weight:700;width:160px;">Project</td><td>${escapeHtml(projectLabel)}</td></tr>
          <tr><td style="font-weight:700;">Vendor</td><td>${escapeHtml(input.order.companyName ?? "Vendor TBD")}</td></tr>
          <tr><td style="font-weight:700;">Order Date</td><td>${formatEmailDate(input.order.sageOrderDate)}</td></tr>
          <tr><td style="font-weight:700;">Required By</td><td>${formatEmailDate(input.order.dueDate)}</td></tr>
          <tr><td style="font-weight:700;">Delivery Location</td><td>${deliveryLocation}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Line</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Description</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Phase</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Cost Code</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Qty</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Unit</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Unit Cost</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="7" style="border:1px solid #111827;padding:6px;text-align:right;font-weight:700;">Total</td>
            <td style="border:1px solid #111827;padding:6px;text-align:right;font-weight:700;">${formatMoney(input.order.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:20px;color:#4b5563;font-size:12px;">
        Sent through Compass by ${escapeHtml(input.senderName)}.
      </p>
    </div>`
}
