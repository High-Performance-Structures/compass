import { normalizedSmsPhoneKey } from "@/lib/goto/numbers"

export type GotoProjectMatchCandidate = {
  readonly id: string
  readonly projectNumber: string | null
  readonly status: string
  readonly contactPhone: string | null
  readonly contactType: string | null
  readonly primaryContact: boolean | null
  readonly ownerNumberMatches: boolean
}

export type GotoProjectMatchResult =
  | {
      readonly kind: "found"
      readonly id: string
      readonly projectNumber: string | null
      readonly reason: "project_number" | "conversation" | "contact_phone"
    }
  | {
      readonly kind: "missing" | "ambiguous"
      readonly candidateProjectIds: readonly string[]
    }

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function bodyMentionsProject(body: string, projectNumber: string | null): boolean {
  const number = projectNumber?.trim()
  if (!number) return false
  return new RegExp(
    `(^|[^a-z0-9])${regexEscape(number)}(?=$|[^a-z0-9])`,
    "i"
  ).test(body)
}

function isOpenStatus(value: string): boolean {
  const status = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
  return ![
    "closed",
    "complete",
    "completed",
    "cancelled",
    "canceled",
    "inactive",
  ].includes(status)
}

function uniqueProjects(
  candidates: readonly GotoProjectMatchCandidate[]
): readonly GotoProjectMatchCandidate[] {
  const byId = new Map<string, GotoProjectMatchCandidate>()
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate)
  }
  return [...byId.values()]
}

function found(
  candidate: GotoProjectMatchCandidate,
  reason: "project_number" | "conversation" | "contact_phone"
): GotoProjectMatchResult {
  return {
    kind: "found",
    id: candidate.id,
    projectNumber: candidate.projectNumber,
    reason,
  }
}

function resolveCandidates(
  candidates: readonly GotoProjectMatchCandidate[],
  reason: "project_number" | "conversation" | "contact_phone"
): GotoProjectMatchResult | null {
  const unique = uniqueProjects(candidates)
  if (unique.length === 1) {
    const candidate = unique[0]
    return candidate ? found(candidate, reason) : null
  }
  if (unique.length === 0) return null

  const open = unique.filter((candidate) => isOpenStatus(candidate.status))
  if (open.length === 1) {
    const candidate = open[0]
    return candidate ? found(candidate, reason) : null
  }
  return {
    kind: "ambiguous",
    candidateProjectIds: (open.length > 0 ? open : unique).map(
      (candidate) => candidate.id
    ),
  }
}

export function matchGotoInboundProject(input: {
  readonly body: string
  readonly senderPhone: string
  readonly priorConversationProjectIds: readonly string[]
  readonly candidates: readonly GotoProjectMatchCandidate[]
}): GotoProjectMatchResult {
  const explicit = resolveCandidates(
    input.candidates.filter((candidate) =>
      bodyMentionsProject(input.body, candidate.projectNumber)
    ),
    "project_number"
  )
  if (explicit) return explicit

  const priorIds = new Set(input.priorConversationProjectIds)
  const conversation = resolveCandidates(
    input.candidates.filter((candidate) => priorIds.has(candidate.id)),
    "conversation"
  )
  if (conversation) return conversation

  const senderKey = normalizedSmsPhoneKey(input.senderPhone)
  if (!senderKey) return { kind: "missing", candidateProjectIds: [] }
  const phoneMatches = input.candidates.filter(
    (candidate) =>
      candidate.ownerNumberMatches &&
      candidate.contactPhone !== null &&
      normalizedSmsPhoneKey(candidate.contactPhone) === senderKey
  )
  const primaryOwnerMatches = phoneMatches.filter(
    (candidate) =>
      candidate.primaryContact === true && candidate.contactType === "owner"
  )
  const contactMatch = resolveCandidates(
    primaryOwnerMatches.length > 0 ? primaryOwnerMatches : phoneMatches,
    "contact_phone"
  )
  return contactMatch ?? { kind: "missing", candidateProjectIds: [] }
}
