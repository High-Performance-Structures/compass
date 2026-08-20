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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeRecipientEmail(value))
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
