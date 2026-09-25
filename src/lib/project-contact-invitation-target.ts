export type ProjectContactInvitationTarget =
  | { readonly kind: "linked_user"; readonly userId: string }
  | { readonly kind: "email"; readonly email: string }

/** An explicit directory-to-account link must never fall back to email matching. */
export function projectContactInvitationTarget(input: {
  readonly linkedUserId: string | null
  readonly directoryEmail: string | null
}): ProjectContactInvitationTarget | null {
  if (input.linkedUserId) {
    return { kind: "linked_user", userId: input.linkedUserId }
  }
  const email = input.directoryEmail?.trim().toLowerCase()
  return email ? { kind: "email", email } : null
}
