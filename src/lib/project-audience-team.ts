import { isInternalStaffRole } from "@/lib/user-roles"

const HIDDEN_AUDIENCE_TEAM_EMAILS = new Set([
  "compass@hps-colorado.com",
  "buildertrend-archive@compass.local",
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
