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

/** An account invitation follows the vendor's email across projects, but
 * project access is still granted separately after the account is active. */
export function vendorAccessStatusWithSharedInvite(input: {
  readonly contactType: string
  readonly projectStatus: ProjectContactAccessStatus
  readonly compassAccountStatus: ProjectContactCompassAccountStatus
  readonly sharedInvitation: ProjectContactInvitationSnapshot | null
  readonly now?: Date
}): ProjectContactAccessStatus {
  if (
    (input.contactType !== "supplier" && input.contactType !== "subcontractor") ||
    input.projectStatus === "active" ||
    input.projectStatus === "inactive" ||
    input.compassAccountStatus !== "not_registered" ||
    input.sharedInvitation === null
  ) {
    return input.projectStatus
  }

  const sharedStatus = projectContactAccessStatus({
    activeProjectMember: false,
    latestInvitation: input.sharedInvitation,
    now: input.now,
  })
  return sharedStatus === "pending" ? "pending" : input.projectStatus
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
