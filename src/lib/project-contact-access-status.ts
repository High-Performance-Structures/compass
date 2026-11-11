export type ProjectContactAccessStatus =
  | "not_invited"
  | "pending"
  | "active"
  | "expired"
  | "inactive"
  // Internal staff of the project's own company: they reach every company job
  // through organization scope, so no project invitation applies.
  | "company_staff"

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
  return status === "not_invited" || status === "expired" || status === "pending"
}

export function projectContactNeedsPersonForInvitation(input: {
  readonly contactType: string
  readonly vendorContactId: string | null
}): boolean {
  if (input.contactType === "supplier" || input.contactType === "subcontractor") {
    return input.vendorContactId === null
  }
  return false
}

export function projectContactAccessStatus(input: {
  /** Current internal staff of the project's own company. */
  readonly companyStaff?: boolean
  readonly activeProjectMember: boolean
  readonly latestInvitation: ProjectContactInvitationSnapshot | null
  readonly compassAccountStatus?: ProjectContactCompassAccountStatus
  readonly now?: Date
}): ProjectContactAccessStatus {
  // Company staff see every job, so a project membership row adds nothing.
  if (input.companyStaff === true) return "company_staff"
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
