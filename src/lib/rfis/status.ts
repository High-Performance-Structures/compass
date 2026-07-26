export type RfiStatus =
  | "new"
  | "in_progress"
  | "info_needed"
  | "complete"
  | "void"

export type RfiStatusFilter = RfiStatus | "open" | "all"

export type RfiPriority = "low" | "normal" | "high"

export type RfiAudience = "internal" | "sub_vendor" | "owner" | "public"

const RFI_STATUS_FILTER_VALUES: readonly RfiStatusFilter[] = [
  "open",
  "new",
  "in_progress",
  "info_needed",
  "complete",
  "void",
  "all",
]

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

export function canonicalRfiStatus(value: string): RfiStatus {
  switch (normalizedStatus(value)) {
    case "open":
    case "new":
      return "new"
    case "answered":
    case "in_progress":
      return "in_progress"
    case "additional_information_needed":
    case "info_needed":
      return "info_needed"
    case "closed":
    case "complete":
    case "completed":
      return "complete"
    case "cancelled":
    case "canceled":
    case "void":
      return "void"
    default:
      return "new"
  }
}

export function isClosedRfiStatus(value: string): boolean {
  const status = canonicalRfiStatus(value)
  return status === "complete" || status === "void"
}

export function parseRfiStatusFilter(
  value: string | readonly string[] | undefined
): RfiStatusFilter {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate) return "open"

  return RFI_STATUS_FILTER_VALUES.find((item) => item === candidate) ?? "open"
}

export function rfiMatchesStatusFilter(
  status: string,
  filter: RfiStatusFilter
): boolean {
  if (filter === "all") return true
  if (filter === "open") return !isClosedRfiStatus(status)
  return canonicalRfiStatus(status) === filter
}

export function compareRfisForQueue(
  left: RfiQueueItem,
  right: RfiQueueItem
): number {
  const leftClosed = isClosedRfiStatus(left.status)
  const rightClosed = isClosedRfiStatus(right.status)
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

export function validRfiStatus(value: string): RfiStatus | null {
  const normalized = normalizedStatus(value)
  const allowed: readonly RfiStatus[] = [
    "new",
    "in_progress",
    "info_needed",
    "complete",
    "void",
  ]
  return allowed.find((item) => item === normalized) ?? null
}

export function validRfiPriority(value: string): RfiPriority | null {
  const normalized = value.trim().toLowerCase()
  return RFI_PRIORITIES.find((item) => item === normalized) ?? null
}

export function validRfiAudience(value: string): RfiAudience | null {
  const normalized = normalizedStatus(value)
  return RFI_AUDIENCES.find((item) => item === normalized) ?? null
}
