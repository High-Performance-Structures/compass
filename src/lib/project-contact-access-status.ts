export type ProjectContactAccessStatus =
  | "not_invited"
  | "pending"
  | "active"
  | "expired"
  | "inactive"

export type ProjectContactCompassAccountStatus =
  | "active"
  | "inactive"
  | "not_registered"

export function projectContactCompassAccountStatus(account: {
  readonly id: string
  readonly isActive: boolean
}): ProjectContactCompassAccountStatus {
  if (account.isActive) return "active"
  return account.id.startsWith("user_") ? "inactive" : "not_registered"
}

export type ProjectContactInvitationSnapshot = {
  readonly status: string
  readonly workosExpiresAt: string | null
  readonly acceptedUserActive: boolean | null
}

export function projectContactCanInvite(
  status: ProjectContactAccessStatus
): boolean {
  return status === "not_invited" || status === "expired"
}

export function projectContactAccessStatus(input: {
  readonly activeProjectMember: boolean
  readonly latestInvitation: ProjectContactInvitationSnapshot | null
  readonly compassAccountStatus?: ProjectContactCompassAccountStatus
  readonly now?: Date
}): ProjectContactAccessStatus {
  if (input.activeProjectMember) return "active"
  if (input.compassAccountStatus === "active") return "not_invited"

  const invitation = input.latestInvitation
  if (!invitation) return "not_invited"

  if (invitation.status === "accepted") {
    return invitation.acceptedUserActive ? "active" : "inactive"
  }
  if (invitation.status === "expired") return "expired"
  if (invitation.status !== "sent") return "not_invited"

  const expiresAt = invitation.workosExpiresAt
    ? new Date(invitation.workosExpiresAt).getTime()
    : Number.NaN
  const now = input.now ?? new Date()
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    return "expired"
  }

  return "pending"
}
