export type EmailRecipientCategory = "vendor" | "client" | "internal"

export type EmailRecipientOption = {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly companyName: string | null
  readonly category: EmailRecipientCategory
  readonly recommended: boolean
}

export type ProjectEmailContact = {
  readonly id: string
  readonly contactType: "owner" | "supplier" | "subcontractor" | "internal"
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
}

function normalizedMatchValue(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? ""
}

export function normalizeRecipientEmail(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function isValidRecipientEmail(value: string): boolean {
  const email = normalizeRecipientEmail(value)
  if (email.length > 254 || /\.\./.test(email)) return false
  const parts = email.split("@")
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain || local.length > 64 || local.startsWith(".") || local.endsWith(".")) return false
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false
  const labels = domain.split(".")
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
}

function recipientCategory(
  contactType: ProjectEmailContact["contactType"]
): EmailRecipientCategory {
  switch (contactType) {
    case "owner":
      return "client"
    case "supplier":
    case "subcontractor":
      return "vendor"
    case "internal":
      return "internal"
  }
}

function matchesRecommendedTarget(
  contact: ProjectEmailContact,
  targets: readonly string[]
): boolean {
  const contactValues = [contact.displayName, contact.companyName]
    .map(normalizedMatchValue)
    .filter(Boolean)

  return targets.some((target) =>
    contactValues.some(
      (candidate) => target.includes(candidate) || candidate.includes(target)
    )
  )
}

const CATEGORY_ORDER: Readonly<Record<EmailRecipientCategory, number>> = {
  vendor: 0,
  client: 1,
  internal: 2,
}

export function buildProjectEmailRecipientOptions(
  contacts: readonly ProjectEmailContact[],
  recommendedTargets: readonly (string | null | undefined)[] = []
): readonly EmailRecipientOption[] {
  const targets = recommendedTargets
    .map((target) => normalizedMatchValue(target ?? null))
    .filter(Boolean)
  const byEmail = new Map<string, EmailRecipientOption>()

  for (const contact of contacts) {
    const email = normalizeRecipientEmail(contact.email ?? "")
    if (!isValidRecipientEmail(email)) continue

    const candidate: EmailRecipientOption = {
      id: contact.id,
      email,
      displayName: contact.displayName,
      companyName: contact.companyName,
      category: recipientCategory(contact.contactType),
      recommended: matchesRecommendedTarget(contact, targets),
    }
    const existing = byEmail.get(email)
    if (!existing || (!existing.recommended && candidate.recommended)) {
      byEmail.set(email, candidate)
    }
  }

  return Array.from(byEmail.values()).sort((first, second) => {
    if (first.recommended !== second.recommended) {
      return first.recommended ? -1 : 1
    }
    const categoryDifference =
      CATEGORY_ORDER[first.category] - CATEGORY_ORDER[second.category]
    if (categoryDifference !== 0) return categoryDifference
    return first.displayName.localeCompare(second.displayName)
  })
}

/** A staff member's other address (not for sign-in), offered next to their usual one. */
export type StaffAlternateEmail = {
  readonly contactId: string
  readonly displayName: string
  readonly email: string
}

/**
 * Adds staff members' other addresses as extra choices. The person's usual
 * address stays where it was (the default); an address already offered is not
 * repeated.
 */
export function withStaffAlternateEmails(
  options: readonly EmailRecipientOption[],
  alternates: readonly StaffAlternateEmail[]
): readonly EmailRecipientOption[] {
  const seen = new Set(options.map((option) => option.email))
  const extraByContact = new Map<string, EmailRecipientOption[]>()
  for (const alternate of alternates) {
    const email = normalizeRecipientEmail(alternate.email)
    if (!isValidRecipientEmail(email) || seen.has(email)) continue
    seen.add(email)
    const option: EmailRecipientOption = {
      id: `${alternate.contactId}:other:${email}`,
      email,
      displayName: `${alternate.displayName} (other address)`,
      companyName: null,
      category: "internal",
      recommended: false,
    }
    extraByContact.set(alternate.contactId, [...(extraByContact.get(alternate.contactId) ?? []), option])
  }
  if (extraByContact.size === 0) return options
  // Right after the person's usual address when it is listed, else at the end.
  const result = options.flatMap((option) => {
    const extra = extraByContact.get(option.id) ?? []
    extraByContact.delete(option.id)
    return [option, ...extra]
  })
  return [...result, ...[...extraByContact.values()].flat()]
}
