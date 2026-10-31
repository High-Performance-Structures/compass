/**
 * Shapes the operations module hands to actions and components: to-dos,
 * purchase orders, RFQs, and the Sage sync queue. Each record carries the
 * actions the server allows on it (architecture standard, section 5).
 */
import type { ProjectTodoHistoryItem } from "@/lib/daily-logs/log-followups-server"
import type { DailyLogCostCodeOption } from "@/lib/daily-logs/daily-log-form"
import type { ProjectTodoStatus } from "@/lib/project-todos"
import type { PortalPurchaseOrderAcknowledgement } from "@/lib/purchase-orders/portal-response"
import type { PortalRfqVendorResponse } from "@/lib/rfqs/portal-response"

export type ProjectOperationKind = "purchase_order" | "rfq"

export type ProjectOperationItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordId: string | null
  readonly linkedScheduleTaskId: string | null
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly assigneeType: string | null
  readonly assigneeName: string | null
  readonly siteContactPhone: string | null
  readonly companyName: string | null
  readonly costCode: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly externalUrl: string | null
  readonly syncStatus: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly sageVendorId: string | null
  readonly sageVendorName: string | null
  readonly sagePhaseCode: string | null
  readonly sageCostCode: string | null
  readonly sageTaxGroup: string | null
  readonly sageShipTo: string | null
  readonly sageOrderDate: string | null
  readonly sageRequiredDate: string | null
  readonly sageWriteStatus: string
  readonly sagePayloadJson: string | null
  readonly updatedAt: string
}

export type ProjectPurchaseOrderLineItem = {
  readonly id: string
  readonly operationId: string
  readonly lineNumber: number
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly description: string
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
  readonly syncStatus: string
}

/** What the viewer may do with a purchase order, decided on the server. */
export type PurchaseOrderActions = {
  /** Still an unsent Compass draft that hasn't gone to Sage. */
  readonly canEdit: boolean
}

export type ProjectPurchaseOrderItem = ProjectOperationItem & {
  readonly actions: PurchaseOrderActions
  readonly lines: readonly ProjectPurchaseOrderLineItem[]
  readonly vendorAddress: string | null
  readonly vendorEmail: string | null
  readonly vendorAcknowledgement: PortalPurchaseOrderAcknowledgement | null
}

export type ProjectPurchaseOrderPhaseOption = {
  readonly value: string
  readonly label: string
}

export type ProjectPurchaseOrderCostCodeOption = {
  readonly onBudget?: boolean
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
}

export type ProjectPurchaseOrderFormOptions = {
  readonly jobsiteAddress: string | null
  readonly phases: readonly ProjectPurchaseOrderPhaseOption[]
  readonly costCodes: readonly ProjectPurchaseOrderCostCodeOption[]
}

export type ProjectRfqScopeLineItem = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly notes: string | null
}

export type ProjectRfqCostCodeOption = {
  readonly onBudget?: boolean
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionLabel: string
}

export type ProjectRfqDocumentLinkItem = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

/** What the viewer may do with an RFQ, decided on the server. */
export type RfqActions = {
  /** No vendor response yet, so the request can still change. */
  readonly canEdit: boolean
  /** Only an unsent draft can be deleted. */
  readonly canDelete: boolean
  /** Template review is done and the RFQ is a draft or already sent. */
  readonly canEmail: boolean
  /** A response can be recorded by hand (before any bid approval). */
  readonly canRecordResponse: boolean
  /** Sharing a draft marks it sent first. */
  readonly sharingMarksSent: boolean
}

export type ProjectRfqItem = ProjectOperationItem & {
  readonly actions: RfqActions
  readonly vendorCategory: string | null
  readonly recipientEmail: string | null
  readonly scopeItems: readonly ProjectRfqScopeLineItem[]
  readonly documentLinks: readonly ProjectRfqDocumentLinkItem[]
  readonly templateReview: {
    readonly unresolvedPlaceholders: readonly string[]
    readonly requiresDocumentPackage: boolean
  } | null
  readonly vendorResponse: PortalRfqVendorResponse | null
}

export type NextScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly source: "compass_schedule" | "sage_operation"
}

export type ProjectOperationsSummary = {
  readonly openPurchaseOrderCount: number
  readonly openPurchaseOrderTotal: number
  readonly activeCommitmentCount: number
  readonly nextScheduleItem: NextScheduleItem | null
  readonly purchaseOrders: readonly ProjectOperationItem[]
  readonly commitments: readonly ProjectOperationItem[]
}

export type ProjectSageSyncItemKind =
  | "project_handoff"
  | "purchase_order"
  | "task"
  | "vendor_bill"
  | "owner_pay_application"
  | "rfq"
  | "budget_application"
  | "budget_line"
  | "google_handoff"

export type ProjectSageSyncItem = {
  readonly id: string
  readonly sourceSystem: string | null
  readonly sourceRecordType: string | null
  readonly kind: ProjectSageSyncItemKind
  readonly table: "project_operations" | "project_budget_applications" | "project_budget_lines"
  readonly title: string
  readonly recordNumber: string | null
  readonly status: string
  readonly syncStatus: string
  readonly sageWriteStatus: string | null
  readonly syncDirection: string | null
  readonly amount: number | null
  readonly dueDate: string | null
  readonly updatedAt: string
  readonly detail: string | null
  readonly companyName: string | null
}

export type ProjectSageSyncQueue = {
  readonly pendingItems: readonly ProjectSageSyncItem[]
  readonly readyCount: number
  readonly queuedCount: number
  readonly blockedCount: number
}

export type ProjectOperationActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type ProjectOperationEmailActionResult =
  | {
      readonly success: true
      readonly status: string
      readonly providerMessageId: string | null
    }
  | { readonly success: false; readonly error: string }

export type ProjectSyncActionResult =
  | { readonly success: true; readonly updatedCount: number }
  | { readonly success: false; readonly error: string }

export type CreatePurchaseOrderRequestInput = {
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly assigneeName: string | null
  readonly siteContactPhone: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly priority: string
  readonly lines: readonly CreatePurchaseOrderLineInput[]
  /** Set when the PO orders against an accepted supplier quote (Selected trades). */
  readonly awardedRfqId?: string | null
}

export type UpdatePurchaseOrderRequestInput =
  CreatePurchaseOrderRequestInput & {
    readonly expectedUpdatedAt: string
  }

export type CreatePurchaseOrderLineInput = {
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number | null
  readonly unitCost: number | null
  readonly unit: string | null
  /**
   * A lump-sum amount typed for the line. Left null, the server prices the
   * line as quantity × unit cost; a client-computed total is never sent.
   */
  readonly amountOverride: number | null
  readonly taxGroup: string | null
}

export type CreateRfqScopeLineInput = {
  readonly selectionId?: string | null
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly notes: string | null
}

export type CreateRfqDocumentLinkInput = {
  readonly label: string | null
  readonly url: string | null
  readonly notes: string | null
}

export type CreateRfqRequestInput = {
  readonly title: string
  readonly vendorCategory: string | null
  readonly requestedFrom: string | null
  readonly recipientEmail: string | null
  readonly responseDueDate: string | null
  readonly priority: string
  readonly scope: string | null
  readonly scopeItems: readonly CreateRfqScopeLineInput[]
  readonly documentLinks: readonly CreateRfqDocumentLinkInput[]
  /** Set by the estimate pricing board so RFQs sent together stay grouped. */
  readonly estimatePackage?: { readonly id: string; readonly title: string; readonly estimateId: string } | null
}

export type UpdateRfqRequestInput = CreateRfqRequestInput

export type DuplicateRfqRequestInput = {
  readonly requestedFrom: string
  readonly recipientEmail: string
}

export type SendPurchaseOrderEmailInput = {
  readonly to: string
  readonly cc: string | null
  readonly subject: string
  readonly message: string
}

/** What the viewer may do with a to-do, decided on the server. */
export type TodoActions = {
  /** Not archived: details and status can change, and it can be archived. */
  readonly canEdit: boolean
  /** Archived: it can be restored or deleted permanently. */
  readonly canRestore: boolean
}

export type ProjectTodoItem = ProjectOperationItem & {
  readonly actions: TodoActions
  readonly createdAt: string
  readonly authorName: string | null
}

export type ProjectTaskRecordType =
  | "staff_task"
  | "subcontractor_task"
  | "supplier_task"
  | "schedule_task"

export type CreateProjectTaskInput = {
  readonly title: string
  readonly description: string | null
  readonly sourceRecordType: ProjectTaskRecordType
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly priority: string
  readonly externalUrl: string | null
}

export type UpdateProjectTodoInput = {
  readonly title: string
  readonly description: string | null
  readonly sourceRecordType: ProjectTaskRecordType
  readonly status: ProjectTodoStatus
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  /** Left out to keep the current cost code. */
  readonly costCode?: string | null
  readonly expectedUpdatedAt: string
}

/** A to-do's history from daily logs and status changes, with hours logged against it. */
export type ProjectTodoDetail = {
  readonly history: readonly ProjectTodoHistoryItem[]
  readonly hours: number
  readonly workedLogCount: number
  /** Ask "Is it finished?" once worked on in this many logs. */
  readonly finishNudgeAfterLogs: number
  /** Cost codes a to-do can carry; empty when the company turned that off. */
  readonly costCodes: readonly DailyLogCostCodeOption[]
}

export type ProjectTodoActionResult =
  | {
      readonly success: true
      readonly id: string
      readonly updatedAt: string
    }
  | { readonly success: false; readonly error: string }

export type SagePurchaseOrderPayload = {
  readonly source: "compass_po_request"
  readonly header: {
    readonly jobId: string | null
    readonly jobNumber: string | null
    readonly vendorId: string | null
    readonly vendorName: string | null
    readonly poNumber: string | null
    readonly description: string
    readonly orderDate: string | null
    readonly requiredDate: string | null
    readonly shipTo: string | null
    readonly status: string
  }
  readonly lines: readonly {
    readonly lineNumber: number
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly description: string
    readonly quantity: number
    readonly unitCost: number
    readonly unit: string | null
    readonly amount: number
    readonly taxGroup: string | null
  }[]
}

export type NormalizedPurchaseOrderLine = {
  readonly lineNumber: number
  readonly description: string
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
}

export type NormalizedRfqScopeLine = {
  readonly lineNumber: number
  readonly description: string
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly notes: string | null
}

export type NormalizedRfqDocumentLink = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}
