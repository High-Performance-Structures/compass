export type WorkOSInvitationDeliveryResult =
  | { readonly success: true; readonly outcome: "invitation_sent" }
  | {
      readonly success: true
      readonly outcome: "existing_user"
      readonly user: {
        readonly id: string
        readonly email: string
        readonly firstName: string | null
        readonly lastName: string | null
        readonly profilePictureUrl: string | null
        readonly lastSignInAt: string | null
      }
    }
  | { readonly success: false; readonly error: string }

/** Resends a pending invitation or creates a replacement for an expired one. */
export async function sendOrResendWorkOSInvitation(input: {
  readonly apiKey: string
  readonly email: string
}): Promise<WorkOSInvitationDeliveryResult> {
  const { WorkOS } = await import("@workos-inc/node")
  const workos = new WorkOS(input.apiKey)
  const workosUsers = await workos.userManagement.listUsers({
    email: input.email,
    limit: 100,
  })
  const existingUser = workosUsers.data.find(
    (user) => user.email.trim().toLowerCase() === input.email.trim().toLowerCase()
  )

  if (existingUser) {
    return {
      success: true,
      outcome: "existing_user",
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        profilePictureUrl: existingUser.profilePictureUrl,
        lastSignInAt: existingUser.lastSignInAt,
      },
    }
  }

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
    return { success: true, outcome: "invitation_sent" }
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
  return { success: true, outcome: "invitation_sent" }
}
