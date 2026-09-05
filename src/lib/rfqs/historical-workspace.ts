import type { RfqHistoricalLine } from "./historical-requests"

export type HistoricalRfqFileView =
  | { readonly status: "verified"; readonly documentInstanceId: string; readonly label: string; readonly url: string }
  | { readonly status: "held"; readonly documentInstanceId: string; readonly label: string; readonly reason: string }

export type HistoricalRfqWorkspaceItem =
  | {
      readonly kind: "request"
      readonly sourceRecordId: string
      readonly requestId: string
      readonly bidPackageId: string
      readonly operationId: string | null
      readonly vendorDisplay: string
      readonly sourceStatus: string
      readonly submission: "draft" | "submitted" | "other"
      readonly pricingReconciliation: "exact" | "unpriced" | "incomplete"
      readonly sourceAmountDisplay: string | null
      readonly submittedAmountCents: number | null
      readonly amountDisplayProvenance: "captured" | "derived"
      readonly releasedDisplay: string | null
      readonly submittedDisplay: string | null
      readonly submittedByDisplay: string | null
      readonly vendorNotes: string | null
      readonly lines: readonly RfqHistoricalLine[]
      readonly attachments: readonly HistoricalRfqFileView[]
      readonly holds: readonly string[]
    }
  | {
      readonly kind: "held"
      readonly sourceRecordId: string
      readonly bidPackageId: string | null
      readonly reason: string
    }

/** Internal-only DTO: no raw capture, source URLs, email addresses or competing-vendor portal data. */
export type HistoricalRfqWorkspace =
  | {
      readonly success: true
      readonly projectId: string
      readonly totalRecords: number
      readonly items: readonly HistoricalRfqWorkspaceItem[]
      readonly nextCursor: string | null
      readonly hasPreviousPage: boolean
    }
  | { readonly success: false; readonly error: string }
