import {
  recordStatusLabel,
  recordStatusSortValue,
  type RecordStatusFilter,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"
import type { ProjectRfqItem } from "@/lib/domain/operations/types"

/** One RFQ as a row of the shared record table on a job's RFQ page. */
export type RfqListRow = {
  readonly id: string
  /** The RFQ number, or "Unnumbered" before one is assigned. */
  readonly rfqNumber: string
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly companyName: string | null
  readonly recipientEmail: string | null
  readonly vendorCategory: string | null
  /** Response needed by (ISO date). */
  readonly dueDate: string | null
  /** The vendor's answer: a quoted amount, a decline, or nothing yet. */
  readonly response:
    | { readonly kind: "none" }
    | { readonly kind: "declined"; readonly submittedAt: string }
    | { readonly kind: "quoted"; readonly amount: number | null; readonly submittedAt: string }
}

export function rfqListRow(rfq: ProjectRfqItem): RfqListRow {
  const answer = rfq.vendorResponse
  return {
    id: rfq.id,
    rfqNumber: rfq.sourceRecordNumber ?? "Unnumbered",
    title: rfq.title,
    description: rfq.description,
    status: rfq.status,
    priority: rfq.priority,
    companyName: rfq.companyName,
    recipientEmail: rfq.recipientEmail,
    vendorCategory: rfq.vendorCategory,
    dueDate: rfq.dueDate,
    response: !answer
      ? { kind: "none" }
      : answer.decision === "decline"
        ? { kind: "declined", submittedAt: answer.submittedAt }
        : { kind: "quoted", amount: answer.amount, submittedAt: answer.submittedAt },
  }
}

/** Status sorts in the company's workflow order (Settings › Statuses), not alphabetically. */
export function rfqStatusSortValue(status: string, statuses: RecordStatusList): number {
  return recordStatusSortValue(statuses, status)
}

/** Who was asked: the company, else the email the request went to. */
export function rfqRequestedFromSortValue(row: RfqListRow): string | undefined {
  return row.companyName?.trim() || row.recipientEmail?.trim() || undefined
}

/**
 * The quote column's sort value: quoted amounts by size, then declines, then
 * RFQs still waiting (undefined, so they sort last).
 */
export function rfqQuoteSortValue(row: RfqListRow): number | undefined {
  if (row.response.kind === "quoted") return row.response.amount ?? 0
  return row.response.kind === "declined" ? -1 : undefined
}

/** When the vendor answered (ISO timestamp), or null while waiting. */
export function rfqRespondedAt(row: RfqListRow): string | null {
  return row.response.kind === "none" ? null : row.response.submittedAt
}

/** Search over the text a row shows: number, title, description, who was asked, trade and status. */
export function rfqMatchesSearch(row: RfqListRow, query: string, statuses: RecordStatusList): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    row.rfqNumber,
    row.title,
    row.description,
    row.companyName,
    row.recipientEmail,
    row.vendorCategory,
    recordStatusLabel(statuses, row.status),
  ].some((value) => value?.toLowerCase().includes(needle))
}

/** The RFQ's record on its job's RFQ page, keeping the list's status filter. */
export function rfqRecordHref(projectId: string, rfqId: string, statusFilter: RecordStatusFilter): string {
  const project = encodeURIComponent(projectId)
  const item = encodeURIComponent(rfqId)
  return `/dashboard/projects/${project}/rfqs?status=${encodeURIComponent(statusFilter)}&item=${item}#rfq-${item}`
}
