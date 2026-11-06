import { isOpenRecordStatus, type RecordStatusList } from "@/lib/domain/record-statuses/rules"

/*
 * RFI priority and audience lists, and the RFI queue order. Statuses (labels,
 * order, Open group, filter buttons, choices) are the company's RFI statuses
 * from src/lib/domain/record-statuses.
 */
export type RfiPriority = "low" | "normal" | "high"

export type RfiAudience = "internal" | "sub_vendor" | "owner" | "public"

const RFI_PRIORITIES: readonly RfiPriority[] = ["low", "normal", "high"]

const RFI_AUDIENCES: readonly RfiAudience[] = [
  "internal",
  "sub_vendor",
  "owner",
  "public",
]

type RfiQueueItem = {
  readonly status: string
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly rfiNumber: string
}

function normalizedStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
}

/**
 * The RFI queue order: open RFIs first (the company's Open group), soonest
 * due first, then newest.
 */
export function compareRfisForQueue(
  statuses: RecordStatusList
): (left: RfiQueueItem, right: RfiQueueItem) => number {
  return (left, right) => compareQueueItems(statuses, left, right)
}

function compareQueueItems(
  statuses: RecordStatusList,
  left: RfiQueueItem,
  right: RfiQueueItem
): number {
  const leftClosed = !isOpenRecordStatus(statuses, left.status)
  const rightClosed = !isOpenRecordStatus(statuses, right.status)
  if (leftClosed !== rightClosed) return leftClosed ? 1 : -1

  if (!leftClosed) {
    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate)
    }
    if (left.dueDate && !right.dueDate) return -1
    if (!left.dueDate && right.dueDate) return 1
  }

  if (left.submittedAt !== right.submittedAt) {
    return right.submittedAt.localeCompare(left.submittedAt)
  }
  return right.rfiNumber.localeCompare(left.rfiNumber)
}

export function validRfiPriority(value: string): RfiPriority | null {
  const normalized = value.trim().toLowerCase()
  return RFI_PRIORITIES.find((item) => item === normalized) ?? null
}

export function validRfiAudience(value: string): RfiAudience | null {
  const normalized = normalizedStatus(value)
  return RFI_AUDIENCES.find((item) => item === normalized) ?? null
}
