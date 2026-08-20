export type WorkOSInvitationDeliveryResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

/** Resends a pending invitation or creates a replacement for an expired one. */
export async function sendOrResendWorkOSInvitation(input: {
  readonly apiKey: string
  readonly email: string
}): Promise<WorkOSInvitationDeliveryResult> {
  const { WorkOS } = await import("@workos-inc/node")
  const workos = new WorkOS(input.apiKey)
  const invitations = await workos.userManagement.listInvitations({
    email: input.email,
    limit: 100,
  })
  const existingInvitations = invitations.data
  const pendingInvitation = existingInvitations.find(
    (invitation) => invitation.state === "pending"
  )

  if (pendingInvitation) {
    await workos.userManagement.resendInvitation(pendingInvitation.id)
    return { success: true }
  }

  if (
    existingInvitations.some((invitation) => invitation.state === "accepted")
  ) {
    return {
      success: false,
      error:
        "Invitation was already accepted. Ask the user to sign in to activate their Compass account.",
    }
  }

  await workos.userManagement.sendInvitation({ email: input.email })
  return { success: true }
}
