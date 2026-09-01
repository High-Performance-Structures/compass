import { isInternalStaffRole } from "@/lib/user-roles"

export const PROJECT_CLIENT_STATUSES = ["lead", "customer"] as const

export type ProjectInteractionTypeOption = {
  readonly id: string
  readonly label: string
}

export const PROJECT_INTERACTION_TYPE_DEFINITIONS = [
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "sms", label: "Text" },
  { id: "meeting", label: "Meeting" },
  { id: "site_visit", label: "Site visit" },
  { id: "client_send", label: "Document/Submittal to Client" },
] as const satisfies readonly { readonly id: string; readonly label: string }[]

const CUSTOM_INTERACTION_TYPE_PREFIX = "custom:"
const CUSTOM_INTERACTION_TYPE_PATTERN = /^[\x20-\x7E]{1,60}$/
const MANUAL_MEANINGFUL_INTERACTION_TYPES = new Set<string>(
  PROJECT_INTERACTION_TYPE_DEFINITIONS.map((type) => type.id),
)

function normalizeInteractionTypeLabel(label: string): string {
  return label.trim().toLowerCase()
}

export function customProjectInteractionType(label: string): string | null {
  const trimmed = label.trim()
  if (!CUSTOM_INTERACTION_TYPE_PATTERN.test(trimmed)) return null
  const normalized = normalizeInteractionTypeLabel(trimmed)
  if (
    PROJECT_INTERACTION_TYPE_DEFINITIONS.some(
      (type) => normalizeInteractionTypeLabel(type.label) === normalized,
    )
  ) {
    return null
  }
  return `${CUSTOM_INTERACTION_TYPE_PREFIX}${trimmed}`
}

function customProjectInteractionTypeLabel(interactionType: string): string | null {
  if (!interactionType.startsWith(CUSTOM_INTERACTION_TYPE_PREFIX)) return null
  const label = interactionType.slice(CUSTOM_INTERACTION_TYPE_PREFIX.length)
  return customProjectInteractionType(label) === interactionType ? label : null
}

export function projectInteractionTypeLabel(interactionType: string): string {
  const builtIn = PROJECT_INTERACTION_TYPE_DEFINITIONS.find(
    (type) => type.id === interactionType,
  )
  if (builtIn) return builtIn.label
  return customProjectInteractionTypeLabel(interactionType) ?? interactionType
}

export function projectInteractionTypeOptions(
  interactionTypes: readonly string[],
): readonly ProjectInteractionTypeOption[] {
  const options: ProjectInteractionTypeOption[] = PROJECT_INTERACTION_TYPE_DEFINITIONS.map(
    (type) => ({ ...type }),
  )
  const labels = new Set(options.map((option) => normalizeInteractionTypeLabel(option.label)))
  const customOptions = interactionTypes
    .map((interactionType) => ({
      id: interactionType,
      label: customProjectInteractionTypeLabel(interactionType),
    }))
    .filter((option): option is { readonly id: string; readonly label: string } => {
      if (!option.label) return false
      const normalized = normalizeInteractionTypeLabel(option.label)
      if (labels.has(normalized)) return false
      labels.add(normalized)
      return true
    })
    .sort((left, right) => left.label.localeCompare(right.label))
  return [...options, ...customOptions]
}

export function isMeaningfulClientInteraction(input: {
  readonly interactionType: string
  readonly direction: string
  readonly source: string
}): boolean {
  if (input.source === "manual") {
    return (
      (input.direction === "inbound" || input.direction === "outbound")
      && (
        MANUAL_MEANINGFUL_INTERACTION_TYPES.has(input.interactionType)
        || customProjectInteractionTypeLabel(input.interactionType) !== null
      )
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

export function legacyProjectStatusAfterClientUpdate(input: {
  readonly currentStatus: string
  readonly clientStatus: ProjectClientStatus
}): string {
  if (
    input.clientStatus === "customer"
    && input.currentStatus.trim().toUpperCase() === "LEAD"
  ) {
    return "OPEN"
  }

  return input.currentStatus
}

export type ProjectJobStatusDefinition = {
  readonly id: string
  readonly label: string
  readonly followUpCadenceDays: number | null
}

export type ProjectJobStatusOption = ProjectJobStatusDefinition & {
  readonly sageCode: string | null
  readonly active: boolean
  readonly builtIn: boolean
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
  { id: "under_warranty", label: "Under Warranty", followUpCadenceDays: null },
  { id: "complete", label: "Complete", followUpCadenceDays: null },
  { id: "closed", label: "Closed", followUpCadenceDays: null },
  { id: "bid_refused", label: "Bid Refused", followUpCadenceDays: null },
  { id: "inactive", label: "Inactive", followUpCadenceDays: null },
] as const satisfies readonly ProjectJobStatusDefinition[]

export function projectJobStatusOptions(
  customStatuses: readonly {
    readonly id: string
    readonly label: string
    readonly sageCode: string | null
    readonly followUpCadenceDays: number | null
    readonly active: boolean
  }[],
  selectedJobStatusId?: string,
): readonly ProjectJobStatusOption[] {
  const seenLabels = new Set<string>()
  const customOptions: ProjectJobStatusOption[] = []
  const selectedBuiltIn = PROJECT_JOB_STATUS_DEFINITIONS.find(
    (status) => status.id === selectedJobStatusId,
  )
  const selectedBuiltInLabel = selectedBuiltIn
    ? normalizeProjectJobStatusLabel(selectedBuiltIn.label)
    : null

  for (const status of customStatuses) {
    const normalizedLabel = normalizeProjectJobStatusLabel(status.label)
    // A controlled select must always contain its persisted value. Prefer the
    // selected built-in on a label collision; otherwise the Sage-backed
    // organization status remains authoritative for that shared label.
    if (normalizedLabel === selectedBuiltInLabel) continue
    if (seenLabels.has(normalizedLabel)) continue
    seenLabels.add(normalizedLabel)
    customOptions.push({ ...status, builtIn: false })
  }

  const builtInOptions = PROJECT_JOB_STATUS_DEFINITIONS
    .filter((status) => !seenLabels.has(normalizeProjectJobStatusLabel(status.label)))
    .map((status) => ({
      id: status.id,
      label: status.label,
      sageCode: null,
      followUpCadenceDays: status.followUpCadenceDays,
      active: true,
      builtIn: true,
    }))

  return [...builtInOptions, ...customOptions]
}

export type ProjectJobStatusId = (typeof PROJECT_JOB_STATUS_DEFINITIONS)[number]["id"]

export type ProjectJobStatusBucket =
  | "active"
  | "warranty"
  | "complete"
  | "inactive"
  | "archive"
  | "other"

export function projectClientStatusLabel(clientStatus: string): string {
  const normalized = clientStatus.trim().toLowerCase()
  if (normalized === "lead") return "Lead"
  if (normalized === "customer") return "Customer"
  return "Unknown client status"
}

export function projectJobStatusLabel(input: {
  readonly jobStatusId: string
  readonly customLabel: string | null
}): string {
  const builtIn = PROJECT_JOB_STATUS_DEFINITIONS.find(
    (status) => status.id === input.jobStatusId,
  )
  if (builtIn) return builtIn.label

  const customLabel = input.customLabel?.trim()
  return customLabel || "Unknown job status"
}

export function projectJobStatusBucket(input: {
  readonly jobStatusId: string
  readonly jobStatusLabel: string
}): ProjectJobStatusBucket {
  const id = input.jobStatusId.trim().toLowerCase()
  const label = input.jobStatusLabel.trim().toLowerCase()

  if (
    id.includes("warranty")
    || label.includes("warranty")
    || label.includes("service")
  ) {
    return "warranty"
  }
  if (
    id === "complete"
    || id === "closed"
    || label === "complete"
    || label === "completed"
    || label === "closed"
  ) {
    return "complete"
  }
  if (
    id === "inactive"
    || id === "bid_refused"
    || id === "paused"
    || label === "inactive"
    || label === "bid refused"
    || label === "paused"
  ) {
    return "inactive"
  }
  if (
    id === "archive"
    || id === "archived"
    || label === "archive"
    || label === "archived"
  ) {
    return "archive"
  }
  if (id === "other" || label === "other" || input.jobStatusLabel === "Unknown job status") {
    return "other"
  }
  return "active"
}

const PROJECT_JOB_STATUS_LABEL_PATTERN = /^[\x20-\x7E]+$/

export function normalizeProjectJobStatusLabel(label: string): string {
  return label.trim().toLowerCase()
}

export function isSupportedProjectJobStatusLabel(label: string): boolean {
  return label === label.trim() && PROJECT_JOB_STATUS_LABEL_PATTERN.test(label)
}

export function isBuiltInProjectJobStatusLabel(label: string): boolean {
  const normalizedLabel = normalizeProjectJobStatusLabel(label)
  return PROJECT_JOB_STATUS_DEFINITIONS.some(
    (status) => normalizeProjectJobStatusLabel(status.label) === normalizedLabel,
  )
}

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
