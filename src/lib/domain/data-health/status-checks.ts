/**
 * Which column each declared state machine governs: the one registry the
 * production drift detector reads (issue #1329). The allowed values always
 * come from the machine itself (its `states`), never a copied list.
 *
 * Every machine made with defineMachine() must appear here at least once;
 * ./__tests__/status-checks.test.ts finds them all in the source and fails
 * when one is missing. A machine that governs several columns (the three
 * Sage AR export tables, the assignee response parts) has one entry each.
 */
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import { invoices, payments } from "@/db/schema-netsuite"
import { organizationAccessRequests } from "@/db/schema-access-requests"
import { projectChangeOrders } from "@/db/schema-change-orders"
import { projectBudgetApplications, projectContractDeposits } from "@/db/schema-financials"
import { projectOperations } from "@/db/schema-operations"
import { projectSourceRecordParticipants, scheduleTaskAssignees } from "@/db/schema-participants"
import {
  sageArInvoiceExports,
  sageChangeOrderExports,
  sageClientProjectWriteOperations,
  sageDepositArExports,
  sageDirectoryAddRequests,
  sageEstimateExports,
  sageInvoiceArExports,
  sageSquarePaymentOperations,
  sageSquareWebhookEvents,
  sageVendorCertificateSyncs,
} from "@/db/schema-sage"
import { scheduleTasks } from "@/db/schema-schedule"
import { projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { projectSelectionRequests } from "@/db/schema-selection-decisions"
import { projectFinishSelections } from "@/db/schema-selections"
import { accessRequestMachine } from "@/lib/domain/access-requests/machine"
import { payApplicationMachine } from "@/lib/domain/budget/pay-application-machine"
import { participantIdentityMachine, participantReviewMachine } from "@/lib/domain/documents/participant-machines"
import { changeOrderMachine } from "@/lib/domain/estimates/change-order-machine"
import { contractDepositMachine } from "@/lib/domain/financials/deposit-machine"
import { receivedPaymentMachine, simpleInvoiceMachine, squareLinkMachine } from "@/lib/domain/financials/invoice-machines"
import { COMPASS_DRAW_SOURCE } from "@/lib/domain/financials/rules"
import { IDENTITY_STATUS_CHECKS } from "@/lib/domain/identity/health-checks"
import { purchaseOrderAutomation, rfqAutomation } from "@/lib/domain/operations/procurement-machines"
import { todoAutomation } from "@/lib/domain/operations/todo-machines"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import {
  arInvoiceExportMachine,
  changeOrderExportMachine,
  clientProjectWriteMachine,
  directoryAddMachine,
  estimateExportMachine,
  vendorCertificateSyncMachine,
} from "@/lib/domain/sage-bridge/machines"
import { squarePaymentOperationMachine, squareWebhookEventMachine } from "@/lib/domain/sage-bridge/square-machines"
import { assigneeResponseMachine } from "@/lib/domain/schedule/assignee-response-machine"
import { confirmationMachine } from "@/lib/domain/schedule/confirmation-machine"
import { roundSignatureMachine, selectionRequestMachine, selectionStatusAutomation } from "@/lib/domain/selections/status-machine"

import type { DeclaredMachine, StatusCheck, StatusCheckOwner } from "./check-types"

/** Which project_operations rows hold a record type's statuses (from the record status registry). */
function operationTypes(type: CompanyStatusType): readonly string[] {
  const records = RECORD_STATUS_REGISTRY[type].records
  return records.table === "project_operations" ? records.sourceRecordTypes : []
}

function byOrganization(column: AnySQLiteColumn): StatusCheckOwner {
  return { organization: column }
}

type CompanyStatusType = "purchase_order" | "rfq" | "todo"

/** Machines that cover only Compass's automatic moves on a company status list. */
const COMPANY_STATUS_MACHINES: readonly { readonly machine: DeclaredMachine; readonly recordType: CompanyStatusType }[] = [
  { machine: todoAutomation, recordType: "todo" },
  { machine: rfqAutomation, recordType: "rfq" },
  { machine: purchaseOrderAutomation, recordType: "purchase_order" },
]

export const STATUS_CHECKS: readonly StatusCheck[] = [
  ...IDENTITY_STATUS_CHECKS,

  // ---- schedule
  { kind: "machine", machine: confirmationMachine, column: scheduleTasks.confirmationStatus, owner: { project: scheduleTasks.projectId } },
  ...[scheduleTaskAssignees.responseStatus, scheduleTaskAssignees.dateResponseStatus, scheduleTaskAssignees.durationResponseStatus].map(
    (column): StatusCheck => ({
      kind: "machine",
      machine: assigneeResponseMachine,
      column,
      owner: { scheduleTask: scheduleTaskAssignees.scheduleTaskId },
    }),
  ),

  // ---- people and access
  {
    kind: "machine",
    machine: accessRequestMachine,
    column: organizationAccessRequests.status,
    owner: byOrganization(organizationAccessRequests.organizationId),
  },

  // ---- money
  {
    kind: "machine",
    machine: contractDepositMachine,
    column: projectContractDeposits.status,
    owner: { project: projectContractDeposits.projectId },
  },
  {
    // Older invoices (no kind: legacy, Sage, Buildertrend) keep the status they were imported with.
    kind: "machine",
    machine: simpleInvoiceMachine,
    column: invoices.status,
    owner: { organization: invoices.organizationId, project: invoices.projectId },
    scope: { column: invoices.invoiceKind, isNotNull: true },
  },
  {
    kind: "machine",
    machine: squareLinkMachine,
    column: invoices.squareState,
    owner: { organization: invoices.organizationId, project: invoices.projectId },
  },
  {
    kind: "not_stored",
    machine: receivedPaymentMachine,
    reason: `${payments.voidedAt.name} set or empty: recorded or void, so no stored value can drift.`,
  },
  {
    // Only Compass draws; projections and imported historical draws keep their own statuses.
    kind: "machine",
    machine: payApplicationMachine,
    column: projectBudgetApplications.status,
    owner: { project: projectBudgetApplications.projectId },
    scope: { column: projectBudgetApplications.sourceSystem, equals: [COMPASS_DRAW_SOURCE] },
  },
  { kind: "machine", machine: changeOrderMachine, column: projectChangeOrders.status, owner: { project: projectChangeOrders.projectId } },

  // ---- selections
  {
    kind: "machine",
    machine: selectionStatusAutomation,
    column: projectFinishSelections.status,
    owner: { project: projectFinishSelections.projectId },
  },
  {
    kind: "machine",
    machine: roundSignatureMachine,
    column: projectSelectionRoundSignatures.status,
    owner: { project: projectSelectionRoundSignatures.projectId },
  },
  {
    kind: "machine",
    machine: selectionRequestMachine,
    column: projectSelectionRequests.status,
    owner: { project: projectSelectionRequests.projectId },
  },

  // ---- to-dos, RFQs and purchase orders: company statuses from Settings › Statuses
  ...COMPANY_STATUS_MACHINES.map(
    ({ machine, recordType }): StatusCheck => ({
      kind: "company_statuses",
      machine,
      recordType,
      column: projectOperations.status,
      owner: { project: projectOperations.projectId },
      scope: { column: projectOperations.sourceRecordType, equals: operationTypes(recordType) },
    }),
  ),

  // ---- imported participants
  {
    kind: "machine",
    machine: participantReviewMachine,
    column: projectSourceRecordParticipants.reviewStatus,
    owner: { organization: projectSourceRecordParticipants.organizationId },
  },
  {
    kind: "machine",
    machine: participantIdentityMachine,
    column: projectSourceRecordParticipants.identityStatus,
    owner: { organization: projectSourceRecordParticipants.organizationId },
  },

  // ---- Sage writer queues
  {
    kind: "machine",
    machine: clientProjectWriteMachine,
    column: sageClientProjectWriteOperations.status,
    owner: byOrganization(sageClientProjectWriteOperations.organizationId),
  },
  {
    kind: "machine",
    machine: changeOrderExportMachine,
    column: sageChangeOrderExports.status,
    owner: byOrganization(sageChangeOrderExports.organizationId),
  },
  {
    kind: "machine",
    machine: vendorCertificateSyncMachine,
    column: sageVendorCertificateSyncs.status,
    owner: byOrganization(sageVendorCertificateSyncs.organizationId),
  },
  {
    kind: "machine",
    machine: estimateExportMachine,
    column: sageEstimateExports.status,
    owner: byOrganization(sageEstimateExports.organizationId),
  },
  ...[sageArInvoiceExports, sageInvoiceArExports, sageDepositArExports].map(
    (table): StatusCheck => ({
      kind: "machine",
      machine: arInvoiceExportMachine,
      column: table.status,
      owner: byOrganization(table.organizationId),
    }),
  ),
  {
    kind: "machine",
    machine: directoryAddMachine,
    column: sageDirectoryAddRequests.status,
    owner: byOrganization(sageDirectoryAddRequests.organizationId),
  },

  // ---- Square → Sage
  // Webhook events belong to no company (one Square account per deployment): every company sees them.
  { kind: "machine", machine: squareWebhookEventMachine, column: sageSquareWebhookEvents.status, owner: {} },
  {
    kind: "machine",
    machine: squarePaymentOperationMachine,
    column: sageSquarePaymentOperations.status,
    owner: { organization: sageSquarePaymentOperations.organizationId, project: sageSquarePaymentOperations.projectId },
  },
]
