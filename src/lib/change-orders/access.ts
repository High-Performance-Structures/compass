import { isExternallyPublishedChangeOrderStatus } from "@/lib/change-orders/status"
import type { ChangeOrderStatus } from "@/lib/change-orders/status"

export type ChangeOrderRequesterType =
  | "internal"
  | "owner"
  | "subcontractor"

export function changeOrderRequesterType(input: {
  readonly internal: boolean
  readonly projectRole: string | null
}): ChangeOrderRequesterType | null {
  if (input.internal) return "internal"
  if (input.projectRole === "client" || input.projectRole === "owner") {
    return "owner"
  }
  if (input.projectRole === "subcontractor") return "subcontractor"
  return null
}

export function canViewChangeOrder(input: {
  readonly internal: boolean
  readonly viewerId: string
  readonly viewerRequesterType: ChangeOrderRequesterType | null
  readonly requesterUserId: string | null
  readonly audience: string
  readonly status: ChangeOrderStatus
}): boolean {
  if (input.internal) return true
  if (input.requesterUserId === input.viewerId) return true
  return (
    input.viewerRequesterType === "owner" &&
    input.audience === "owner" &&
    isExternallyPublishedChangeOrderStatus(input.status)
  )
}
