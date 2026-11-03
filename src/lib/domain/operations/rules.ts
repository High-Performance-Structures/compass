/**
 * Pure operations rules: numbering, input cleanup, purchase-order math, the
 * Sage queue rules, and which actions a record allows. No database or
 * network access (architecture standard, section 1).
 */
import { cleanText } from "@/lib/shared/guards"
import { isArchivedProjectTodoStatus } from "@/lib/project-todos"
import { canEditPurchaseOrderDraft, type PurchaseOrderDraftState } from "@/lib/purchase-orders/draft-edit"

import type {
  CreatePurchaseOrderLineInput,
  CreateRfqDocumentLinkInput,
  CreateRfqScopeLineInput,
  NormalizedPurchaseOrderLine,
  NormalizedRfqDocumentLink,
  NormalizedRfqScopeLine,
  ProjectSageSyncItemKind,
  ProjectTaskRecordType,
  PurchaseOrderActions,
  RfqActions,
  SagePurchaseOrderPayload,
  TodoActions,
} from "./types"

// ---------------------------------------------------------------------------
// Input cleanup
// ---------------------------------------------------------------------------

/** A trimmed value, or throws "<label> is required". */
export function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

/** A "YYYY-MM-DD" calendar date, null when blank, or throws for anything else. */
export function cleanDate(value: string | null, label: string): string | null {
  const cleaned = cleanText(value)
  if (cleaned === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${label} must be a valid date`)
  }
  // Noon UTC never rolls the day, so a round trip proves the date is real.
  const parsed = new Date(`${cleaned}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== cleaned) {
    throw new Error(`${label} must be a valid date`)
  }
  return cleaned
}

/** Comma, space, or semicolon separated addresses, lowercased; invalid ones dropped. */
export function parseEmailList(value: string | null): readonly string[] {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return []
  return trimmed
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

function sequenceAfter(existingCount: number): string {
  return String(existingCount + 1).padStart(3, "0")
}

export function purchaseOrderRequestNumberFor(
  projectNumber: string | null,
  existingCount: number,
  id: string,
): string {
  const sequence = sequenceAfter(existingCount)
  const prefix = cleanText(projectNumber)
  if (prefix) return `${prefix}-PO-${sequence}`
  // Without a project number, part of the id keeps two jobs' requests apart.
  return `PO-REQ-${sequence}-${id.slice(0, 6).toUpperCase()}`
}

export function projectDocumentNumberFor(
  projectNumber: string | null,
  documentType: string,
  existingCount: number,
): string {
  const sequence = sequenceAfter(existingCount)
  const prefix = cleanText(projectNumber)
  return prefix ? `${prefix}-${documentType}-${sequence}` : `${documentType}-${sequence}`
}

/** Sage's shorter form: only the department and series of the project number. */
export function sageShortProjectDocumentNumberFor(
  projectNumber: string | null,
  documentType: string,
  existingCount: number,
): string {
  const sequence = sequenceAfter(existingCount)
  const prefix = cleanText(projectNumber)
  if (!prefix) return `${documentType}-${sequence}`
  const [department, series] = prefix.split("-")
  if (department && series) return `${department}-${series}-${documentType}-${sequence}`
  return `${prefix}-${documentType}-${sequence}`
}

export function projectTaskNumberFor(existingCount: number): string {
  return `TASK-${sequenceAfter(existingCount)}`
}

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------

export function normalizeTaskRecordType(value: ProjectTaskRecordType): ProjectTaskRecordType {
  if (value === "subcontractor_task") return "subcontractor_task"
  if (value === "supplier_task") return "supplier_task"
  if (value === "schedule_task") return "schedule_task"
  return "staff_task"
}

export function assigneeTypeForTask(recordType: ProjectTaskRecordType): string {
  if (recordType === "subcontractor_task") return "subcontractor"
  if (recordType === "supplier_task") return "supplier"
  return "internal"
}

export function todoActions(todo: { readonly status: string }): TodoActions {
  const archived = isArchivedProjectTodoStatus(todo.status)
  return { canEdit: !archived, canRestore: archived }
}

export type TodoEventInput = {
  readonly organizationId: string
  readonly projectId: string
  readonly todoId: string
  readonly kind: "created" | "worked" | "still_blocked" | "unblocked" | "status"
  readonly dailyLogId: string | null
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly actorId: string | null
  readonly createdAt?: string
}

/** The stored history row: notes are trimmed to 500 characters. */
export function todoEventRow(event: TodoEventInput): {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly todoId: string
  readonly kind: TodoEventInput["kind"]
  readonly dailyLogId: string | null
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly actorId: string | null
  readonly createdAt: string
} {
  return {
    id: crypto.randomUUID(),
    organizationId: event.organizationId,
    projectId: event.projectId,
    todoId: event.todoId,
    kind: event.kind,
    dailyLogId: event.dailyLogId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note?.trim().slice(0, 500) || null,
    actorId: event.actorId,
    createdAt: event.createdAt ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

function numberOrDefault(value: number | null, fallback: number): number {
  return value === null || !Number.isFinite(value) ? fallback : value
}

/** Dollars rounded to whole cents (the amount columns hold dollars). */
function wholeCents(dollars: number): number {
  return Math.round(dollars * 100) / 100
}

/**
 * A purchase-order line's amount in dollars: the typed lump sum when there
 * is one, otherwise quantity × unit cost, rounded to the cent. The create
 * form previews with this same function; the server recomputes it on save.
 */
export function purchaseOrderLineAmount(line: {
  readonly quantity: number
  readonly unitCost: number
  readonly amountOverride: number | null
}): number {
  const override = line.amountOverride
  if (override !== null && Number.isFinite(override)) return wholeCents(override)
  return wholeCents(line.quantity * line.unitCost)
}

/** The header amount: the lines summed in integer cents so floats never drift. */
export function purchaseOrderTotal(lines: readonly { readonly amount: number }[]): number {
  return lines.reduce((cents, line) => cents + Math.round(line.amount * 100), 0) / 100
}

export function normalizePurchaseOrderLines(
  lines: readonly CreatePurchaseOrderLineInput[],
  fallbackDescription: string,
): readonly NormalizedPurchaseOrderLine[] {
  const normalized = lines.flatMap((line, index): NormalizedPurchaseOrderLine[] => {
    const description = cleanText(line.description)
    const costCode = cleanText(line.costCode)
    const phaseCode = cleanText(line.phaseCode)
    const taxGroup = cleanText(line.taxGroup)
    const unit = cleanText(line.unit)
    const quantity = numberOrDefault(line.quantity, 1)
    const unitCost = numberOrDefault(line.unitCost, 0)
    const amount = purchaseOrderLineAmount({ quantity, unitCost, amountOverride: line.amountOverride })
    const hasMeaningfulValue =
      description !== null ||
      costCode !== null ||
      phaseCode !== null ||
      taxGroup !== null ||
      unit !== null ||
      amount > 0 ||
      unitCost > 0
    if (!hasMeaningfulValue) return []
    return [
      {
        lineNumber: index + 1,
        description: description ?? fallbackDescription,
        costCode,
        phaseCode,
        quantity,
        unitCost,
        unit,
        amount,
        taxGroup,
      },
    ]
  })
  if (normalized.length > 0) return normalized
  return [
    {
      lineNumber: 1,
      description: fallbackDescription,
      costCode: null,
      phaseCode: null,
      quantity: 1,
      unitCost: 0,
      unit: null,
      amount: 0,
      taxGroup: null,
    },
  ]
}

/** One line's codes carry up to the header; several lines leave it blank. */
export function purchaseOrderHeaderCodes(lines: readonly NormalizedPurchaseOrderLine[]): {
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly taxGroup: string | null
} {
  const only = lines.length === 1 ? lines[0] : undefined
  return {
    costCode: only?.costCode ?? null,
    phaseCode: only?.phaseCode ?? null,
    taxGroup: only?.taxGroup ?? null,
  }
}

export function buildSagePurchaseOrderPayload(input: {
  readonly project: { readonly sageJobId: string | null; readonly sageJobNumber: string | null }
  readonly sourceRecordNumber: string
  readonly title: string
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly lines: readonly NormalizedPurchaseOrderLine[]
}): SagePurchaseOrderPayload {
  return {
    source: "compass_po_request",
    header: {
      jobId: input.project.sageJobId,
      jobNumber: input.project.sageJobNumber,
      vendorId: input.sageVendorId,
      vendorName: input.companyName,
      poNumber: input.sourceRecordNumber,
      description: input.title,
      orderDate: input.orderDate,
      requiredDate: input.dueDate,
      shipTo: input.shipTo,
      status: "draft",
    },
    lines: input.lines.map((line) => ({
      lineNumber: line.lineNumber,
      phaseCode: line.phaseCode,
      costCode: line.costCode,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
      amount: line.amount,
      taxGroup: line.taxGroup,
    })),
  }
}

export function purchaseOrderActions(order: PurchaseOrderDraftState): PurchaseOrderActions {
  return { canEdit: canEditPurchaseOrderDraft(order) }
}

const PURCHASE_ORDER_CLOSED = new Set(["closed", "void", "complete"])

export function isOpenPurchaseOrderStatus(status: string): boolean {
  return !PURCHASE_ORDER_CLOSED.has(status)
}

// ---------------------------------------------------------------------------
// RFQs
// ---------------------------------------------------------------------------

export function normalizeRfqScopeLines(
  lines: readonly CreateRfqScopeLineInput[],
  fallbackDescription: string,
): readonly NormalizedRfqScopeLine[] {
  const normalized = lines.flatMap((line, index): NormalizedRfqScopeLine[] => {
    const description = cleanText(line.description)
    const costCode = cleanText(line.costCode)
    const phaseCode = cleanText(line.phaseCode)
    const notes = cleanText(line.notes)
    if (description === null && costCode === null && phaseCode === null && notes === null) return []
    return [{ lineNumber: index + 1, description: description ?? fallbackDescription, costCode, phaseCode, notes }]
  })
  if (normalized.length > 0) return normalized
  return [{ lineNumber: 1, description: fallbackDescription, costCode: null, phaseCode: null, notes: null }]
}

export function normalizeRfqDocumentLinks(
  links: readonly CreateRfqDocumentLinkInput[],
): readonly NormalizedRfqDocumentLink[] {
  return links.flatMap((link, index): NormalizedRfqDocumentLink[] => {
    const label = cleanText(link.label)
    const url = cleanText(link.url)
    const notes = cleanText(link.notes)
    if (label === null && url === null && notes === null) return []
    if (url === null) throw new Error("Each RFQ document link needs a URL.")
    return [{ lineNumber: index + 1, label: label ?? `Document ${index + 1}`, url, notes }]
  })
}

const RFQ_EMAILABLE = new Set(["draft", "sent"])
const RFQ_MANUAL_RESPONSE = new Set(["draft", "sent", "response_received", "declined"])

export function rfqActions(rfq: {
  readonly status: string
  readonly vendorResponse: unknown
  readonly templateReview: unknown
}): RfqActions {
  return {
    canEdit: !rfq.vendorResponse,
    canDelete: rfq.status === "draft",
    canEmail: rfq.templateReview === null && RFQ_EMAILABLE.has(rfq.status),
    canRecordResponse: RFQ_MANUAL_RESPONSE.has(rfq.status),
    sharingMarksSent: rfq.status === "draft",
  }
}

/** A Sage RFP link record, kept in the RFQ payload until Sage writes exist. */
export function sageRfpLink(suggestedRecordNumber: string): {
  readonly targetRecordType: "sage_rfp"
  readonly linkStrategy: "external_document_links"
  readonly suggestedRecordNumber: string
  readonly writeStatus: "not_ready"
} {
  return {
    targetRecordType: "sage_rfp",
    linkStrategy: "external_document_links",
    suggestedRecordNumber,
    writeStatus: "not_ready",
  }
}

// ---------------------------------------------------------------------------
// Sage sync queue
// ---------------------------------------------------------------------------

export function operationSyncKind(recordType: string): ProjectSageSyncItemKind {
  if (recordType === "sage_project_handoff") return "project_handoff"
  if (recordType === "google_project_intake") return "project_handoff"
  if (recordType === "purchase_order") return "purchase_order"
  if (recordType === "google_nutech_order") return "purchase_order"
  if (recordType === "vendor_bill") return "vendor_bill"
  if (recordType === "owner_pay_application") return "owner_pay_application"
  if (recordType === "rfq") return "rfq"
  if (recordType === "google_finish_schedule" || recordType === "google_script_handoff") {
    return "google_handoff"
  }
  return "task"
}

export function operationCanQueueForSage(operation: {
  readonly syncDirection: string | null
  readonly syncStatus: string
  readonly sageWriteStatus: string
}): boolean {
  if (operation.syncDirection !== "write") return false
  if (["queued_sage", "syncing", "synced"].includes(operation.syncStatus)) return false
  if (operation.sageWriteStatus === "not_ready") return false
  return ["pending_sage", "needs_review", "failed", "compass_only"].includes(operation.syncStatus)
}

export function syncQueueStatus(item: {
  readonly syncStatus: string
  readonly sageWriteStatus: string | null
  readonly syncDirection: string | null
}): "ready" | "queued" | "blocked" {
  if (item.syncStatus === "queued_sage" || item.syncStatus === "syncing") return "queued"
  if (item.syncDirection !== "write") return "blocked"
  if (item.sageWriteStatus === "not_ready") return "blocked"
  return "ready"
}
