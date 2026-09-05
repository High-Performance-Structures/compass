import type { SelectionSpecification } from "./decisions"

export type SelectionRequest = {
  readonly id: string
  readonly kind: "pricing" | "alternative"
  readonly note: string
  readonly productUrl: string | null
  readonly requesterName: string
  readonly status: "open" | "resolved" | "withdrawn"
  readonly response: string | null
  readonly updatedAt: string
  readonly canEdit: boolean
}
export type SelectionDecisionItem = {
  readonly id: string
  readonly spec: SelectionSpecification
  readonly currentSpec: SelectionSpecification
  readonly revision: number
  readonly published: boolean
  readonly current: boolean
  readonly decisionDueDate: string | null
  readonly allowanceCents: number | null
  readonly quotedCents: number | null
  readonly scheduleImpact: string | null
  readonly ownerNote: string | null
  readonly requiresChangeOrder: boolean
  readonly changeOrderId: string | null
  readonly approvedAt: string | null
  readonly approvedByName: string | null
  readonly approvalBlocker: string | null
  readonly status: string
  readonly selectionUpdatedAt: string
  readonly requests: readonly SelectionRequest[]
  readonly history: readonly {
    readonly revision: number
    readonly actorName: string
    readonly createdAt: string
    readonly specification: SelectionSpecification
    readonly priceCents: number | null
    readonly allowanceCents: number | null
    readonly scheduleImpact: string | null
  }[]
  readonly links: readonly {
    readonly id: string
    readonly label: string
    readonly href: string
    readonly current: boolean
  }[]
}
export type SelectionWorkspace = {
  readonly projectId: string
  readonly audience: "staff" | "owner" | "sub_vendor"
  readonly canWrite: boolean
  readonly items: readonly SelectionDecisionItem[]
  readonly changeOrders: readonly {
    readonly id: string
    readonly label: string
  }[]
  readonly purchaseOrders: readonly {
    readonly id: string
    readonly label: string
  }[]
}
