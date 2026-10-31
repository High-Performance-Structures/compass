/**
 * Turns stored project_operations rows into the records actions return:
 * to-dos, purchase orders, and RFQs, each with the actions the server
 * allows on it. Pure: no database access.
 */
import { isRecord } from "@/lib/shared/guards"
import { linkedScheduleTaskId } from "@/lib/schedule/linked-todos"
import { parsePortalPurchaseOrderPayload } from "@/lib/purchase-orders/portal-response"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"
import type { projectPurchaseOrderLines } from "@/db/schema"

import { purchaseOrderActions, rfqActions, todoActions } from "./rules"
import type { OperationRow } from "./store"
import type {
  ProjectOperationItem,
  ProjectPurchaseOrderItem,
  ProjectPurchaseOrderLineItem,
  ProjectRfqDocumentLinkItem,
  ProjectRfqItem,
  ProjectRfqScopeLineItem,
  ProjectTodoItem,
} from "./types"

type PurchaseOrderLineRow = typeof projectPurchaseOrderLines.$inferSelect
type JsonRecord = Readonly<Record<string, unknown>>

export function stringValue(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function numberValue(record: JsonRecord, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function parseJsonRecord(value: string | null): JsonRecord | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseRfqScopeItems(
  payload: JsonRecord | null,
  fallbackDescription: string | null,
): readonly ProjectRfqScopeLineItem[] {
  const rawLines = payload?.scopeItems
  if (!Array.isArray(rawLines)) {
    return fallbackDescription
      ? [{ lineNumber: 1, description: fallbackDescription, phaseCode: null, costCode: null, notes: null }]
      : []
  }
  return rawLines.flatMap((line: unknown, index): ProjectRfqScopeLineItem[] => {
    if (!isRecord(line)) return []
    const description = stringValue(line, "description") ?? fallbackDescription
    if (!description) return []
    return [
      {
        lineNumber: numberValue(line, "lineNumber") ?? index + 1,
        description,
        phaseCode: stringValue(line, "phaseCode"),
        costCode: stringValue(line, "costCode"),
        notes: stringValue(line, "notes"),
      },
    ]
  })
}

function parseRfqDocumentLinks(payload: JsonRecord | null): readonly ProjectRfqDocumentLinkItem[] {
  const rawLinks = payload?.documentLinks
  if (!Array.isArray(rawLinks)) return []
  return rawLinks.flatMap((link: unknown, index): ProjectRfqDocumentLinkItem[] => {
    if (!isRecord(link)) return []
    const url = stringValue(link, "url")
    if (url === null) return []
    return [
      {
        lineNumber: numberValue(link, "lineNumber") ?? index + 1,
        label: stringValue(link, "label") ?? `Document ${index + 1}`,
        url,
        notes: stringValue(link, "notes"),
      },
    ]
  })
}

export function parseRfqTemplateReview(payload: JsonRecord | null): ProjectRfqItem["templateReview"] {
  const value = payload?.templateReview
  if (!isRecord(value)) return null
  const rawPlaceholders = value.unresolvedPlaceholders
  const unresolvedPlaceholders = Array.isArray(rawPlaceholders)
    ? rawPlaceholders.filter((placeholder): placeholder is string => typeof placeholder === "string")
    : []
  const requiresDocumentPackage = value.requiresDocumentPackage === true
  return unresolvedPlaceholders.length > 0 || requiresDocumentPackage
    ? { unresolvedPlaceholders, requiresDocumentPackage }
    : null
}

export function toOperationItem(
  row: OperationRow,
  scheduleTaskIds: ReadonlySet<string> = new Set(),
): ProjectOperationItem {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    linkedScheduleTaskId: linkedScheduleTaskId(row, scheduleTaskIds),
    sourceRecordNumber: row.sourceRecordNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeType: row.assigneeType,
    assigneeName: row.assigneeName,
    siteContactPhone: row.siteContactPhone,
    companyName: row.companyName,
    costCode: row.costCode,
    startDate: row.startDate,
    dueDate: row.dueDate,
    amount: row.amount,
    externalUrl: row.externalUrl,
    syncStatus: row.syncStatus,
    sageJobId: row.sageJobId,
    sageJobNumber: row.sageJobNumber,
    sageVendorId: row.sageVendorId,
    sageVendorName: row.sageVendorName,
    sagePhaseCode: row.sagePhaseCode,
    sageCostCode: row.sageCostCode,
    sageTaxGroup: row.sageTaxGroup,
    sageShipTo: row.sageShipTo,
    sageOrderDate: row.sageOrderDate,
    sageRequiredDate: row.sageRequiredDate,
    sageWriteStatus: row.sageWriteStatus,
    sagePayloadJson: row.sagePayloadJson,
    updatedAt: row.updatedAt,
  }
}

export function toTodoItem(row: OperationRow, scheduleTaskIds: ReadonlySet<string>): ProjectTodoItem {
  return { ...toOperationItem(row, scheduleTaskIds), actions: todoActions(row), createdAt: row.createdAt, authorName: null }
}

export function toRfqItem(row: OperationRow, recipientEmail: string | null): ProjectRfqItem {
  const payload = parseJsonRecord(row.sagePayloadJson)
  const vendorResponse = parsePortalRfqPayload(row.sagePayloadJson).vendorResponse
  const templateReview = parseRfqTemplateReview(payload)
  return {
    ...toOperationItem(row),
    actions: rfqActions({ status: row.status, vendorResponse, templateReview }),
    vendorCategory: stringValue(payload ?? {}, "vendorCategory"),
    recipientEmail: stringValue(payload ?? {}, "recipientEmail") ?? recipientEmail,
    scopeItems: parseRfqScopeItems(payload, row.description),
    documentLinks: parseRfqDocumentLinks(payload),
    templateReview,
    vendorResponse,
  }
}

function toPurchaseOrderLineItem(row: PurchaseOrderLineRow): ProjectPurchaseOrderLineItem {
  return {
    id: row.id,
    operationId: row.operationId,
    lineNumber: row.lineNumber,
    costCode: row.costCode,
    phaseCode: row.phaseCode,
    description: row.description,
    quantity: row.quantity,
    unitCost: row.unitCost,
    unit: row.unit,
    amount: row.amount,
    taxGroup: row.taxGroup,
    syncStatus: row.syncStatus,
  }
}

export function toPurchaseOrderItem(
  row: OperationRow,
  lines: readonly PurchaseOrderLineRow[],
  vendor: { readonly address: string | null; readonly email: string | null },
): ProjectPurchaseOrderItem {
  return {
    ...toOperationItem(row),
    actions: purchaseOrderActions(row),
    lines: lines.map(toPurchaseOrderLineItem),
    vendorAddress: vendor.address,
    vendorEmail: vendor.email,
    vendorAcknowledgement: parsePortalPurchaseOrderPayload(row.sagePayloadJson).acknowledgement,
  }
}
