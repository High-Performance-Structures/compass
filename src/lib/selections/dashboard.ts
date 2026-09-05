import type { SelectionWorkspace } from "./types"
export type SelectionDashboardSummary =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available"
      readonly awaitingApproval: number
      readonly awaitingTeam: number
      readonly items: readonly {
        readonly id: string
        readonly name: string
        readonly roomName: string
        readonly dueDate: string | null
      }[]
    }
export function selectionDashboardSummary(
  workspace: SelectionWorkspace
): SelectionDashboardSummary {
  const pending = workspace.items
    .filter(
      (item) =>
        item.published && !item.approvedAt && item.approvalBlocker === null
    )
    .sort((a, b) =>
      (a.decisionDueDate ?? "9999").localeCompare(b.decisionDueDate ?? "9999")
    )
  return {
    kind: "available",
    awaitingApproval: pending.length,
    awaitingTeam: workspace.items.filter((item) =>
      item.requests.some((request) => request.status === "open")
    ).length,
    items: pending.slice(0, 4).map((item) => ({
      id: item.id,
      name: item.spec.name,
      roomName: item.spec.roomName,
      dueDate: item.decisionDueDate,
    })),
  }
}
