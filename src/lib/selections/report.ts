import type { PortalReport, PortalReportItem } from "@/lib/print/portal-report"
import { selectionMoney } from "./decisions"
import type { SelectionDecisionItem, SelectionWorkspace } from "./types"

export function selectionReport(
  items: readonly SelectionDecisionItem[],
  audience: SelectionWorkspace["audience"],
): PortalReport {
  const partner = audience === "sub_vendor"
  const rooms = new Map<string, PortalReportItem[]>()
  for (const item of items) {
    const spec = audience === "staff" ? item.currentSpec : item.spec
    const rows = rooms.get(spec.roomName) ?? []
    rows.push({
      title: spec.name,
      status: partner
        ? `Owner approved · Revision ${item.revision}`
        : !item.current
          ? "Specification changed — revision pending"
          : item.approvedAt
            ? `Owner approved · Revision ${item.revision}`
            : `Awaiting decision · Revision ${item.revision}`,
      fields: [
        ["Category", spec.category],
        ["Quantity", spec.quantity],
        ["Manufacturer", spec.manufacturer],
        ["Model", spec.model],
        ["Color / finish", spec.colorFinish],
        ["Supplier", spec.supplierName],
        ...(!partner
          ? ([
              ["Allowance", selectionMoney(item.allowanceCents)],
              ["Quoted price", selectionMoney(item.quotedCents)],
              ["Decision due", item.decisionDueDate],
              ["Approved by", item.approvedByName],
              ["Approved at", item.approvedAt],
            ] satisfies PortalReportItem["fields"])
          : []),
      ],
      paragraphs: [
        ["Specification", spec.description],
        ["Product link", spec.productUrl],
        ...(!partner
          ? ([
              ["Schedule impact", item.scheduleImpact],
              ["Owner note", item.ownerNote],
            ] satisfies NonNullable<PortalReportItem["paragraphs"]>)
          : []),
      ],
    })
    rooms.set(spec.roomName, rows)
  }
  return {
    title: partner
      ? "Approved Finish Selections"
      : "Finish Selections & Decisions",
    note: partner
      ? "Current published owner-approved specifications for project coordination. Check Compass for revisions before ordering or installation."
      : "Published selections in the current view. Pending choices are not authorizations to order or install. Check Compass for the latest decisions.",
    groups: Array.from(rooms, ([title, rows]) => ({ title, items: rows })),
  }
}
