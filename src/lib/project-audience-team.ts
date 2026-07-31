import { isInternalStaffRole } from "@/lib/user-roles"

const HIDDEN_AUDIENCE_TEAM_EMAILS = new Set([
  "compass@hps-colorado.com",
  "buildertrend-archive@compass.local",
  "nicholai@biohazardvfx.com",
])

export function isVisibleAudienceTeamMember(input: {
  readonly userId: string
  readonly email: string
  readonly role: string
}): boolean {
  const normalizedEmail = input.email.trim().toLowerCase()
  return (
    isInternalStaffRole(input.role) &&
    !input.userId.startsWith("svc_") &&
    !normalizedEmail.endsWith("@compass.local") &&
    !HIDDEN_AUDIENCE_TEAM_EMAILS.has(normalizedEmail)
  )
}

export function isAssignedVisibleAudienceTeamMember(input: {
  readonly userId: string
  readonly email: string
  readonly organizationRole: string
  readonly projectRole: string | null
}): boolean {
  return (
    input.projectRole !== null &&
    isInternalStaffRole(input.projectRole) &&
    isVisibleAudienceTeamMember({
      userId: input.userId,
      email: input.email,
      role: input.organizationRole,
    })
  )
}
