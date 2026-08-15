import { isInternalStaffRole } from "@/lib/user-roles"

export const PROJECT_CLIENT_STATUSES = ["lead", "customer"] as const

const MANUAL_MEANINGFUL_INTERACTION_TYPES = new Set([
  "call",
  "email",
  "meeting",
  "site_visit",
  "client_send",
])

export function isMeaningfulClientInteraction(input: {
  readonly interactionType: string
  readonly direction: string
  readonly source: string
}): boolean {
  if (input.source === "manual") {
    return (
      (input.direction === "inbound" || input.direction === "outbound")
      && MANUAL_MEANINGFUL_INTERACTION_TYPES.has(input.interactionType)
    )
  }
  return (
    input.direction === "inbound"
    && ((input.source === "email" && input.interactionType === "email")
      || (input.source === "goto_sms" && input.interactionType === "sms"))
  )
}

export function isEligibleFollowUpOwner(input: {
  readonly active: boolean
  readonly role: string
}): boolean {
  return input.active && isInternalStaffRole(input.role)
}

export type ProjectClientStatus = (typeof PROJECT_CLIENT_STATUSES)[number]

export type ProjectJobStatusDefinition = {
  readonly id: string
  readonly label: string
  readonly followUpCadenceDays: number | null
}

export const PROJECT_JOB_STATUS_DEFINITIONS = [
  { id: "intake", label: "Intake", followUpCadenceDays: 2 },
  {
    id: "new_client_info_sent",
    label: "New Client Info Sent",
    followUpCadenceDays: 2,
  },
  {
    id: "budget_estimating",
    label: "Budget Estimating",
    followUpCadenceDays: 3,
  },
  {
    id: "budget_estimate_sent",
    label: "Budget Estimate Sent",
    followUpCadenceDays: 3,
  },
  { id: "estimating", label: "Estimating", followUpCadenceDays: 3 },
  {
    id: "estimate_sent",
    label: "Estimate Sent",
    followUpCadenceDays: 3,
  },
  {
    id: "design_proposal",
    label: "Design Proposal",
    followUpCadenceDays: 3,
  },
  {
    id: "design_proposal_sent",
    label: "Design Proposal Sent",
    followUpCadenceDays: 3,
  },
  {
    id: "design_proposal_signed",
    label: "Design Proposal Signed",
    followUpCadenceDays: 3,
  },
  { id: "engineering", label: "Engineering", followUpCadenceDays: 7 },
  { id: "contract_docs", label: "Contract Docs", followUpCadenceDays: 3 },
  {
    id: "contract_docs_sent",
    label: "Contract Docs Sent",
    followUpCadenceDays: 3,
  },
  {
    id: "contract_docs_signed",
    label: "Contract Docs Signed",
    followUpCadenceDays: 3,
  },
  { id: "contract", label: "Contract", followUpCadenceDays: 3 },
  { id: "awarded", label: "Awarded", followUpCadenceDays: 7 },
  {
    id: "awaiting_funding",
    label: "Awaiting Funding",
    followUpCadenceDays: 7,
  },
  {
    id: "awaiting_groundbreaking",
    label: "Awaiting Groundbreaking",
    followUpCadenceDays: 7,
  },
  { id: "permitting", label: "Permitting", followUpCadenceDays: 7 },
  { id: "in_design", label: "In Design", followUpCadenceDays: 7 },
  {
    id: "value_engineering",
    label: "Value Engineering",
    followUpCadenceDays: 7,
  },
  { id: "takeoff", label: "Takeoff", followUpCadenceDays: 7 },
  { id: "bracing_out", label: "Bracing Out", followUpCadenceDays: 7 },
  {
    id: "under_construction",
    label: "Under Construction",
    followUpCadenceDays: 7,
  },
  { id: "ordered", label: "Ordered", followUpCadenceDays: 7 },
  { id: "partial_order", label: "Partial Order", followUpCadenceDays: 7 },
  {
    id: "price_sheet_sent",
    label: "Price Sheet Sent",
    followUpCadenceDays: 7,
  },
  { id: "shipping_tbd", label: "Shipping TBD", followUpCadenceDays: 7 },
  {
    id: "awaiting_payment",
    label: "Awaiting Payment",
    followUpCadenceDays: 7,
  },
  { id: "current", label: "Current", followUpCadenceDays: 7 },
  { id: "punchlist", label: "Punchlist", followUpCadenceDays: 7 },
  { id: "complete", label: "Complete", followUpCadenceDays: null },
  { id: "closed", label: "Closed", followUpCadenceDays: null },
  { id: "bid_refused", label: "Bid Refused", followUpCadenceDays: null },
  { id: "inactive", label: "Inactive", followUpCadenceDays: null },
] as const satisfies readonly ProjectJobStatusDefinition[]

export type ProjectJobStatusId = (typeof PROJECT_JOB_STATUS_DEFINITIONS)[number]["id"]

export const FOLLOW_UP_EXCLUDED_JOB_STATUSES = [
  "complete",
  "closed",
  "bid_refused",
  "inactive",
] as const satisfies readonly ProjectJobStatusId[]

export type ProjectNumberParts = {
  readonly department: "O" | "H" | "N" | "D"
  readonly sequence: string
  readonly addressSuffix: string
}

const PROJECT_NUMBER_PATTERN = /^([OHND])-(\d+)-([A-Z0-9]+)$/i

export function projectNumberParts(value: string): ProjectNumberParts | null {
  const match = PROJECT_NUMBER_PATTERN.exec(value.trim())
  if (!match) return null

  const department = match[1]?.toUpperCase()
  const sequence = match[2]
  const addressSuffix = match[3]?.toUpperCase()
  if (
    (department !== "O" && department !== "H" && department !== "N" && department !== "D") ||
    !sequence ||
    !addressSuffix
  ) {
    return null
  }

  return { department, sequence, addressSuffix }
}

export function buildProjectNumberWithAddressSuffix(
  projectNumber: string,
  addressSuffix: string,
): string {
  const parts = projectNumberParts(projectNumber)
  if (!parts) {
    throw new Error("Project number must include a recognized department and sequence.")
  }

  const normalizedSuffix = addressSuffix.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(normalizedSuffix)) {
    throw new Error("Project-number address suffix may contain only letters and numbers.")
  }

  return `${parts.department}-${parts.sequence}-${normalizedSuffix}`
}

export function defaultFollowUpCadenceDays(statusId: string): number | null {
  return (
    PROJECT_JOB_STATUS_DEFINITIONS.find((status) => status.id === statusId)
      ?.followUpCadenceDays ?? null
  )
}

export function isFollowUpEligibleJobStatus(statusId: string): boolean {
  return defaultFollowUpCadenceDays(statusId) !== null
}
