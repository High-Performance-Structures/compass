import { and, asc, eq, inArray } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  projectChangeOrderDocuments,
  projectChangeOrderLines,
  projectChangeOrders,
  projectContacts,
  projectOperations,
  projectPurchaseOrderLines,
  projectRfis,
  projects,
  vendors,
} from "@/db/schema"
import type { AudienceRfi } from "@/app/actions/project-audience-preview"
import type { PurchaseOrderDocumentData } from "@/components/projects/purchase-order-document"
import type { ChangeOrderReportItem } from "@/lib/print/audience-record-reports"
import type { ReportProject } from "@/lib/print/portal-report"
import { isChangeOrderStatus } from "@/lib/change-orders/status"
import { projectNumberAndName } from "@/lib/project-display-name"
import { resolvedPurchaseOrderShipTo } from "@/lib/purchase-orders/ship-to"
import { purchaseOrderVendorDetails } from "@/lib/purchase-orders/vendor-details"

/*
 * Data for the record-copy print page. These loaders run only after the page
 * has verified a single-record pass, and each returns only the record that
 * pass names (matched on both record and project).
 */

type Db = ReturnType<typeof getDb>

async function reportProject(db: Db, projectId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

export async function purchaseOrderCopyData(
  db: Db,
  projectId: string,
  recordId: string,
): Promise<{
  readonly projectNumber: string | null
  readonly projectLabel: string
  readonly deliveryLocation: string | null
  readonly order: PurchaseOrderDocumentData
} | null> {
  const project = await reportProject(db, projectId)
  if (!project) return null
  const [order] = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.id, recordId),
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "purchase_order"),
      ),
    )
    .limit(1)
  if (!order) return null
  const [lines, contactRows, vendorRows] = await Promise.all([
    db
      .select()
      .from(projectPurchaseOrderLines)
      .where(eq(projectPurchaseOrderLines.operationId, recordId))
      .orderBy(asc(projectPurchaseOrderLines.lineNumber)),
    db
      .select({
        address: projectContacts.address,
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true),
          inArray(projectContacts.contactType, ["supplier", "subcontractor"]),
        ),
      ),
    project.organizationId
      ? db
          .select({
            address: vendors.address,
            name: vendors.name,
            email: vendors.email,
            netsuiteId: vendors.netsuiteId,
            sourceRecordId: vendors.sourceRecordId,
            sourceRecordNumber: vendors.sourceRecordNumber,
          })
          .from(vendors)
          .where(eq(vendors.organizationId, project.organizationId))
      : Promise.resolve([]),
  ])
  const vendor = purchaseOrderVendorDetails({ order, contacts: contactRows, vendors: vendorRows })
  return {
    projectNumber: project.projectNumber,
    projectLabel: projectNumberAndName(project),
    deliveryLocation: resolvedPurchaseOrderShipTo({ storedShipTo: order.sageShipTo, jobsiteAddress: project.address }),
    order: {
      sourceRecordNumber: order.sourceRecordNumber,
      sageOrderDate: order.sageOrderDate,
      dueDate: order.dueDate,
      companyName: order.companyName,
      vendorAddress: vendor.address,
      assigneeName: order.assigneeName,
      siteContactPhone: order.siteContactPhone,
      amount: order.amount,
      title: order.title,
      description: order.description,
      lines: lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        description: line.description,
        phaseCode: line.phaseCode,
        costCode: line.costCode,
        quantity: line.quantity,
        unit: line.unit,
        unitCost: line.unitCost,
        amount: line.amount,
      })),
    },
  }
}

export async function rfiCopyData(
  db: Db,
  projectId: string,
  recordId: string,
): Promise<{ readonly project: ReportProject; readonly rfi: AudienceRfi } | null> {
  const project = await reportProject(db, projectId)
  if (!project) return null
  const [row] = await db
    .select()
    .from(projectRfis)
    .where(and(eq(projectRfis.id, recordId), eq(projectRfis.projectId, projectId)))
    .limit(1)
  if (!row) return null
  return {
    project: { id: project.id, name: project.name, projectNumber: project.projectNumber },
    rfi: {
      id: row.id,
      rfiNumber: row.rfiNumber,
      subject: row.subject,
      question: row.question,
      answer: row.answer,
      status: row.status,
      priority: row.priority,
      requesterName: row.requesterName,
      assignedToName: row.assignedToName,
      companyName: row.companyName,
      dueDate: row.dueDate,
      submittedAt: row.submittedAt,
      answeredAt: row.answeredAt,
    },
  }
}

export async function changeOrderCopyData(
  db: Db,
  projectId: string,
  recordId: string,
): Promise<{ readonly project: ReportProject; readonly changeOrder: ChangeOrderReportItem } | null> {
  const project = await reportProject(db, projectId)
  if (!project) return null
  const [row] = await db
    .select()
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, recordId), eq(projectChangeOrders.projectId, projectId)))
    .limit(1)
  // Stored as text; skip rows whose status is not one Compass knows.
  if (!row || !isChangeOrderStatus(row.status)) return null
  const status = row.status
  const [lines, documents] = await Promise.all([
    db
      .select({
        lineNumber: projectChangeOrderLines.lineNumber,
        description: projectChangeOrderLines.description,
        amountCents: projectChangeOrderLines.amountCents,
      })
      .from(projectChangeOrderLines)
      .where(eq(projectChangeOrderLines.changeOrderId, recordId))
      .orderBy(asc(projectChangeOrderLines.lineNumber)),
    db
      .select({ label: projectChangeOrderDocuments.label, url: projectChangeOrderDocuments.url, notes: projectChangeOrderDocuments.notes })
      .from(projectChangeOrderDocuments)
      .where(eq(projectChangeOrderDocuments.changeOrderId, recordId))
      .orderBy(asc(projectChangeOrderDocuments.createdAt)),
  ])
  return {
    project: { id: project.id, name: project.name, projectNumber: project.projectNumber },
    changeOrder: {
      changeOrderNumber: row.changeOrderNumber,
      title: row.title,
      status,
      sourceType: row.sourceType,
      requesterName: row.requesterName,
      requesterCompany: row.requesterCompany,
      amountCents: row.amountCents,
      scheduleImpactDays: row.scheduleImpactDays,
      submittedAt: row.submittedAt,
      scope: row.scope,
      reason: row.reason,
      lines,
      documents,
    },
  }
}
