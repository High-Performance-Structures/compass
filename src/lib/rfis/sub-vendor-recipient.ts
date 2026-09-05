export type SubVendorRfiRecipient = {
  readonly userId: string
  readonly displayName: string
}

export type ResolvedSubVendorRfiRecipient =
  | {
      readonly valid: true
      readonly userId: string | null
      readonly displayName: string
    }
  | { readonly valid: false }

export function resolveSubVendorRfiRecipient(
  recipients: readonly SubVendorRfiRecipient[],
  requestedUserId: string | null
): ResolvedSubVendorRfiRecipient {
  const requested = requestedUserId?.trim() ?? ""
  if (requested) {
    const recipient = recipients.find((member) => member.userId === requested)
    return recipient
      ? {
          valid: true,
          userId: recipient.userId,
          displayName: recipient.displayName,
        }
      : { valid: false }
  }

  const firstRecipient = recipients[0]
  return firstRecipient
    ? {
        valid: true,
        userId: firstRecipient.userId,
        displayName: firstRecipient.displayName,
      }
    : { valid: true, userId: null, displayName: "Project team" }
}
