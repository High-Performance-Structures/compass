import type { PortalReport, PortalReportItem } from "@/lib/print/portal-report"
import { DEFAULT_SELECTION_STATUS_LABELS, selectionProgressLabel, type SelectionStatusLabels } from "@/lib/domain/selections/status-labels"
import { selectionMoney } from "./decisions"
import type { SelectionDecisionItem, SelectionWorkspace } from "./types"

export function selectionReport(
  items: readonly SelectionDecisionItem[],
  audience: SelectionWorkspace["audience"],
  /** The company's status names (the workspace's `statusLabels`). */
  statusLabels: SelectionStatusLabels = DEFAULT_SELECTION_STATUS_LABELS,
): PortalReport {
  const partner = audience === "sub_vendor"
  const rooms = new Map<string, PortalReportItem[]>()
  for (const item of items) {
    const spec = audience === "staff" ? item.currentSpec : item.spec
    const rows = rooms.get(spec.roomName) ?? []
    rows.push({
      title: spec.name,
      status: partner
        ? `Approved · Revision ${item.revision}`
        : !item.current
          ? "Specification changed — revision pending"
          : item.signed
            ? `Approved (signed) · Revision ${item.revision}`
            : item.approvedAt
            ? `Owner's choice · Revision ${item.revision}`
            : `Awaiting decision · Revision ${item.revision}`,
      fields: [
        ["Category", spec.category],
        ["Quantity", spec.quantity],
        ["Manufacturer", spec.manufacturer],
        ["Model", spec.model],
        ["Color / finish", spec.colorFinish],
        ["Supplier", spec.supplierName],
        ["Progress", selectionProgressLabel(item.status, statusLabels)],
        ...(!partner
          ? ([
              ["Allowance", selectionMoney(item.allowanceCents)],
              ["Quoted price", selectionMoney(item.quotedCents)],
              ["Decision due", item.decisionDueDate],
              ["Owner's choice by", item.approvedByName],
              ["Owner's choice at", item.approvedAt],
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
