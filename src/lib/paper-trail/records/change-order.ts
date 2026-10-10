import { asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projects,
} from "@/db/schema"
import { changeOrderDisplayStatus, isChangeOrderStatus } from "@/lib/change-orders/status"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"
import { statusLabel } from "@/lib/project-operations/status"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100)
}

export async function loadChangeOrderRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [row] = await db
    .select({ order: projectChangeOrders, project: { name: projects.name, projectNumber: projects.projectNumber } })
    .from(projectChangeOrders)
    .innerJoin(projects, eq(projects.id, projectChangeOrders.projectId))
    .where(eq(projectChangeOrders.id, recordId))
    .limit(1)
  if (!row) return null
  const { order, project } = row
  const [lines, documents, history] = await Promise.all([
    db.select().from(projectChangeOrderLines).where(eq(projectChangeOrderLines.changeOrderId, recordId)).orderBy(asc(projectChangeOrderLines.lineNumber)),
    db.select().from(projectChangeOrderDocuments).where(eq(projectChangeOrderDocuments.changeOrderId, recordId)).orderBy(asc(projectChangeOrderDocuments.createdAt)),
    db.select().from(projectChangeOrderHistory).where(eq(projectChangeOrderHistory.changeOrderId, recordId)).orderBy(asc(projectChangeOrderHistory.createdAt)),
  ])

  const brand = projectBrandFor({ projectId: order.projectId, projectNumber: project.projectNumber })
  const number = order.changeOrderNumber?.trim() || "Unnumbered"
  const days = order.scheduleImpactDays

  return {
    projectId: order.projectId,
    version: [
      order.updatedAt,
      lines.length,
      ...lines.map((line) => line.updatedAt),
      documents.length,
      history.length,
    ].join("|"),
    fileBaseName: `CO ${number} - ${order.title}`,
    sheet: {
      companyName: brand.companyName,
      companyLines: brand.contactLines,
      recordLabel: "Change Order",
      title: `CO ${number}`,
      projectLabel: projectNumberAndName(project),
      status: isChangeOrderStatus(order.status) ? changeOrderDisplayStatus(order.status, order.sourceType) : statusLabel(order.status),
      sections: [
        {
          kind: "fields",
          heading: "Change order",
          fields: [
            ["Title", order.title],
            ["Amount", money(order.amountCents)],
            ["Schedule impact", days === null ? "Not set" : `${days} day${days === 1 ? "" : "s"}`],
            ["Requested by", [order.requesterName, order.requesterCompany].filter(Boolean).join(" · ")],
            ["Visible to", statusLabel(order.audience)],
            ["Budget treatment", order.budgetTreatment ? statusLabel(order.budgetTreatment) : null],
            ["Submitted", order.submittedAt],
            ["Executed", order.executedAt],
          ],
        },
        { kind: "text", heading: "Scope", body: order.scope },
        { kind: "text", heading: "Reason", body: order.reason },
        {
          kind: "table",
          heading: "Lines",
          columns: [{ label: "Line" }, { label: "Description" }, { label: "Cost code" }, { label: "Amount", align: "right" }],
          rows: lines.map((line) => [String(line.lineNumber), line.description, line.costCode ?? "", money(line.amountCents)]),
          footer: ["", "Total", "", money(order.amountCents)],
        },
        { kind: "text", heading: "Internal notes", body: order.internalNotes },
        {
          kind: "table",
          heading: "Documents",
          columns: [{ label: "Document" }, { label: "Link" }],
          rows: documents.map((item) => [item.label, item.url]),
        },
        {
          kind: "table",
          heading: "History",
          columns: [{ label: "When" }, { label: "Event" }, { label: "By" }, { label: "Note" }],
          rows: history.map((item) => [
            item.createdAt.slice(0, 16).replace("T", " "),
            item.toStatus ? `${statusLabel(item.fromStatus ?? "")} → ${statusLabel(item.toStatus)}`.replace(/^ → /, "") : statusLabel(item.eventType),
            item.actorName ?? "",
            item.note ?? "",
          ]),
        },
      ],
    },
  }
}
