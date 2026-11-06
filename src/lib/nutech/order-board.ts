import type { NuTechOrderBoardSettings } from "@/lib/nutech/settings"
import { formatDate } from "@/lib/format"
import {
  nuTechOrderStatusLabel,
  type NuTechDeliveryMethod,
  type NuTechOrderStatus,
  type NuTechVendorInvoiceStatus,
} from "@/lib/nutech/workflow"

/**
 * The Nu-Tech order board: one row per order across every N job, and the
 * "needs attention" boxes staff work from each morning. Pure, so the rules
 * are tested without a database; the action supplies today's date and the
 * company's settings.
 */

export type NuTechBoardQueue = "ships_soon" | "approved_unpaid" | "unconfirmed" | "no_invoice"

export const NUTECH_BOARD_QUEUES: readonly NuTechBoardQueue[] = [
  "ships_soon",
  "approved_unpaid",
  "unconfirmed",
  "no_invoice",
]

/** Status filter buttons above the sheet. */
export type NuTechBoardStatusFilter = "open" | "complete" | "cancelled" | "all"

export type NuTechBoardOrderInput = {
  readonly orderId: string
  readonly orderNumber: number
  readonly orderTitle: string | null
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly orderStatus: NuTechOrderStatus
  readonly deliveryMethod: NuTechDeliveryMethod
  /** YYYY-MM-DD. */
  readonly requestedDeliveryDate: string | null
  /** ISO timestamp or YYYY-MM-DD. */
  readonly customerPaidAt: string | null
  readonly purchaseOrderReleasedAt: string | null
  readonly vendorConfirmationNumber: string | null
  readonly vendorInvoiceNumber: string | null
  readonly vendorInvoiceStatus: NuTechVendorInvoiceStatus
  readonly updatedAt: string
}

export type NuTechBoardRow = NuTechBoardOrderInput & {
  readonly statusLabel: string
  readonly queues: readonly NuTechBoardQueue[]
  /** The one thing to do next, in plain words; empty for closed orders. */
  readonly nextStep: string
  /** Whether the next step is a problem to chase rather than the normal next move. */
  readonly nextStepUrgent: boolean
  /** Ships soon with nothing paid. */
  readonly unpaidBeforeShipping: boolean
}

export type NuTechBoard = {
  readonly rows: readonly NuTechBoardRow[]
  readonly queueCounts: Readonly<Record<NuTechBoardQueue, number>>
  readonly statusCounts: Readonly<Record<NuTechBoardStatusFilter, number>>
}

const CLOSED: ReadonlySet<NuTechOrderStatus> = new Set(["complete", "cancelled"])
/** Before the customer accepts the estimate, there is nothing to collect yet. */
const BEFORE_APPROVAL: ReadonlySet<NuTechOrderStatus> = new Set(["intake", "quantities_ready", "estimate_ready"])

function dateKey(value: string | null): string | null {
  if (!value) return null
  const key = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number)
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000)
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/** Weekdays after `from` up to and including `to`; 0 when `to` is not later. */
export function businessDaysBetween(from: string, to: string): number {
  const start = dayNumber(from)
  const end = dayNumber(to)
  let count = 0
  for (let day = start + 1; day <= end; day += 1) {
    // 1970-01-01 (day 0) was a Thursday, so (day + 4) % 7 is 0 on Sundays.
    const weekday = (day + 4) % 7
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

export function nuTechBoardQueues(
  order: NuTechBoardOrderInput,
  today: string,
  settings: NuTechOrderBoardSettings,
): readonly NuTechBoardQueue[] {
  if (CLOSED.has(order.orderStatus)) return []
  const queues: NuTechBoardQueue[] = []
  const requested = dateKey(order.requestedDeliveryDate)
  if (requested) {
    const daysOut = daysBetween(today, requested)
    if (daysOut >= 0 && daysOut <= settings.shipsWithinDays) queues.push("ships_soon")
  }
  if (!BEFORE_APPROVAL.has(order.orderStatus) && !order.customerPaidAt) queues.push("approved_unpaid")
  const released = dateKey(order.purchaseOrderReleasedAt)
  if (
    order.orderStatus === "po_released" &&
    !order.vendorConfirmationNumber?.trim() &&
    released &&
    businessDaysBetween(released, today) >= settings.confirmationBusinessDays
  ) {
    queues.push("unconfirmed")
  }
  if (
    order.orderStatus === "vendor_confirmed" &&
    order.vendorInvoiceStatus === "not_received" &&
    requested &&
    daysBetween(requested, today) >= settings.invoiceAfterDeliveryDays
  ) {
    queues.push("no_invoice")
  }
  return queues
}

function nextStep(
  order: NuTechBoardOrderInput,
  queues: readonly NuTechBoardQueue[],
  manufacturerName: string,
): { readonly text: string; readonly urgent: boolean } {
  const requested = dateKey(order.requestedDeliveryDate)
  const released = dateKey(order.purchaseOrderReleasedAt)
  if (queues.includes("unconfirmed")) {
    return { text: `Call ${manufacturerName}: no confirmation since ${released ? formatDate(released, "short") : "the PO went out"}.`, urgent: true }
  }
  if (queues.includes("approved_unpaid")) {
    return {
      text: queues.includes("ships_soon") && requested ? `Collect payment before ${formatDate(requested, "short")}.` : "Collect the customer's payment.",
      urgent: true,
    }
  }
  if (queues.includes("no_invoice")) return { text: `Ask ${manufacturerName} for the invoice.`, urgent: true }
  switch (order.orderStatus) {
    case "intake":
      return { text: "Get the quantities.", urgent: false }
    case "quantities_ready":
      return { text: "Build and send the estimate.", urgent: false }
    case "estimate_ready":
      return { text: "Waiting for the customer to accept the estimate.", urgent: false }
    case "customer_approved":
      return { text: "Prepare the manufacturer PO.", urgent: false }
    case "po_ready":
      return { text: `Send the PO to ${manufacturerName}.`, urgent: false }
    case "po_released":
      return { text: `Waiting for ${manufacturerName} to confirm.`, urgent: false }
    case "vendor_confirmed":
      return { text: requested ? `${order.deliveryMethod === "delivery" ? "Delivery" : "Pickup"} ${formatDate(requested, "short")}.` : "Set the pickup or delivery date.", urgent: !requested }
    case "invoice_received":
      return { text: "Release the vendor invoice to accounting.", urgent: false }
    case "invoice_released":
      return { text: "Mark the order complete once it's picked up or delivered.", urgent: false }
    case "complete":
    case "cancelled":
      return { text: "", urgent: false }
  }
}

export function matchesNuTechBoardStatus(row: { readonly orderStatus: NuTechOrderStatus }, filter: NuTechBoardStatusFilter): boolean {
  switch (filter) {
    case "open":
      return !CLOSED.has(row.orderStatus)
    case "complete":
    case "cancelled":
      return row.orderStatus === filter
    case "all":
      return true
  }
}

export function buildNuTechOrderBoard(input: {
  readonly orders: readonly NuTechBoardOrderInput[]
  readonly today: string
  readonly settings: NuTechOrderBoardSettings
  readonly manufacturerName: string
}): NuTechBoard {
  const manufacturer = input.manufacturerName.trim() || "the manufacturer"
  const rows = input.orders.map((order): NuTechBoardRow => {
    const queues = nuTechBoardQueues(order, input.today, input.settings)
    const step = nextStep(order, queues, manufacturer)
    return {
      ...order,
      statusLabel: nuTechOrderStatusLabel(order.orderStatus),
      queues,
      nextStep: step.text,
      nextStepUrgent: step.urgent,
      unpaidBeforeShipping: queues.includes("ships_soon") && !order.customerPaidAt,
    }
  })
  const queueCounts: Record<NuTechBoardQueue, number> = { ships_soon: 0, approved_unpaid: 0, unconfirmed: 0, no_invoice: 0 }
  for (const row of rows) for (const queue of row.queues) queueCounts[queue] += 1
  const statusCounts: Record<NuTechBoardStatusFilter, number> = {
    open: rows.filter((row) => matchesNuTechBoardStatus(row, "open")).length,
    complete: rows.filter((row) => row.orderStatus === "complete").length,
    cancelled: rows.filter((row) => row.orderStatus === "cancelled").length,
    all: rows.length,
  }
  return { rows, queueCounts, statusCounts }
}
