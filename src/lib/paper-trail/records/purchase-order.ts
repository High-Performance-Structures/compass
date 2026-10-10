import { and, asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectOperations, projectPurchaseOrderLines, projects } from "@/db/schema"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"
import { statusLabel } from "@/lib/project-operations/status"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value ?? 0)
}

function quantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

export async function loadPurchaseOrderRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [row] = await db
    .select({ order: projectOperations, project: { name: projects.name, projectNumber: projects.projectNumber } })
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(and(eq(projectOperations.id, recordId), eq(projectOperations.sourceRecordType, "purchase_order")))
    .limit(1)
  if (!row) return null
  const { order, project } = row
  const lines = await db
    .select()
    .from(projectPurchaseOrderLines)
    .where(eq(projectPurchaseOrderLines.operationId, recordId))
    .orderBy(asc(projectPurchaseOrderLines.lineNumber))

  const brand = projectBrandFor({ projectId: order.projectId, projectNumber: project.projectNumber })
  const number = order.sourceRecordNumber?.trim() || "Unnumbered"
  const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const vendor = order.sageVendorName ?? order.companyName

  return {
    projectId: order.projectId,
    // Header edits bump updatedAt; line edits are covered by their own timestamps.
    version: [order.updatedAt, lines.length, ...lines.map((line) => line.updatedAt)].join("|"),
    fileBaseName: `PO ${number}${order.title ? ` - ${order.title}` : ""}`,
    sheet: {
      companyName: brand.companyName,
      companyLines: brand.contactLines,
      recordLabel: "Purchase Order",
      title: `PO ${number}`,
      projectLabel: projectNumberAndName(project),
      status: statusLabel(order.status),
      sections: [
        {
          kind: "fields",
          heading: "Order",
          fields: [
            ["Title", order.title],
            ["Vendor", vendor],
            ["Order date", order.sageOrderDate],
            ["Required by", order.sageRequiredDate ?? order.dueDate],
            ["Ship to", order.sageShipTo],
            ["Cost code", order.sageCostCode ?? order.costCode],
            ["Phase", order.sagePhaseCode],
            ["Total", money(order.amount ?? lineTotal)],
          ],
        },
        {
          kind: "table",
          heading: "Lines",
          columns: [
            { label: "Line" },
            { label: "Description" },
            { label: "Cost code" },
            { label: "Qty", align: "right" },
            { label: "Unit" },
            { label: "Unit cost", align: "right" },
            { label: "Amount", align: "right" },
          ],
          rows: lines.map((line) => [
            String(line.lineNumber),
            line.description,
            line.costCode ?? "",
            quantity(line.quantity),
            line.unit ?? "",
            money(line.unitCost),
            money(line.amount),
          ]),
          footer: ["", "Total", "", "", "", "", money(lineTotal)],
        },
        { kind: "text", heading: "Notes", body: order.description },
      ],
    },
  }
}
