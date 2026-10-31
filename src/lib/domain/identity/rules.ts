/**
 * Pure identity rules (architecture standard, section 1). No database or
 * network access, so they can be unit-tested and shared by the store,
 * auth and the user actions.
 */

/**
 * Organization role for an invited owner or vendor. An invited "owner" is a
 * client of the company, so it joins the organization as "client".
 */
export function externalOrganizationRole(role: string): string {
  return role === "owner" ? "client" : role
}

/**
 * A local users row created by an invitation before the person signed in:
 * inactive, never logged in, and keyed by a Compass UUID rather than a
 * WorkOS "user_" id.
 */
export function isPendingInvitationPlaceholder(user: {
  readonly id: string
  readonly isActive: boolean
  readonly lastLoginAt: string | null
}): boolean {
  return !user.isActive && user.lastLoginAt === null && !user.id.startsWith("user_")
}

const DELETED_USER_DISPLAY_NAME = "Deleted user"

/**
 * The users row is kept because project, financial and audit records point
 * at it. Everything that identifies the person is cleared, and the email
 * becomes a unique placeholder so the address can sign up again later.
 */
export type DeidentifiedUserValues = {
  readonly email: string
  readonly firstName: null
  readonly lastName: null
  readonly displayName: string
  readonly phone: null
  readonly address: null
  readonly avatarUrl: null
  readonly dashboardDeskPhotoUrl: null
  readonly sidebarDeskPhotoUrl: null
  readonly googleEmail: null
  readonly isActive: false
  readonly updatedAt: string
}

export function deidentifiedUserValues(userId: string, now: string): DeidentifiedUserValues {
  return {
    email: `deleted+${userId}@deleted.invalid`,
    firstName: null,
    lastName: null,
    displayName: DELETED_USER_DISPLAY_NAME,
    phone: null,
    address: null,
    avatarUrl: null,
    dashboardDeskPhotoUrl: null,
    sidebarDeskPhotoUrl: null,
    googleEmail: null,
    isActive: false,
    updatedAt: now,
  }
}
