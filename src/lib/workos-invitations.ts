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

/** A project welcome email needs the current WorkOS URL and expiry as well as the ID. */
export async function sendOrResendProjectWorkOSInvitation(input: {
  readonly apiKey: string
  readonly email: string
}): Promise<{ readonly id: string; readonly expiresAt: string; readonly acceptInvitationUrl: string }> {
  const { WorkOS } = await import("@workos-inc/node")
  const workos = new WorkOS(input.apiKey)
  const invitations = await workos.userManagement.listInvitations({ email: input.email, limit: 100 })
  // Account invitations have no WorkOS organization. Do not reuse an unrelated
  // organization's invitation just because the email matches.
  const pending = invitations.data.find((invitation) =>
    invitation.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
    invitation.organizationId === null && invitation.state === "pending"
  )
  const invitation = pending
    ? await workos.userManagement.resendInvitation(pending.id)
    : await workos.userManagement.sendInvitation({ email: input.email, expiresInDays: 14 })
  return { id: invitation.id, expiresAt: invitation.expiresAt, acceptInvitationUrl: invitation.acceptInvitationUrl }
}

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

  // WorkOS may create the user object before invitation acceptance. Only a
  // user who has actually signed in should bypass invitation delivery.
  if (existingUser?.lastSignInAt) {
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
    !existingUser &&
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
