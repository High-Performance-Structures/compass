/**
 * The one rule that decides a signed-in person's role and active
 * organization (issue #1329, phase 1). Pure: auth reads the memberships and
 * the active-org cookie, this decides. Every page, action and permission
 * check sees the result as `AuthUser.role` / `AuthUser.organizationId`.
 */
import { isExternalProjectRole } from "@/lib/user-roles"

import { externalOrganizationRole } from "./rules"

export type SessionOrgMembership = {
  readonly orgId: string
  readonly orgName: string
  readonly orgType: string
  readonly memberRole: string
}

export type SessionRoleInput = {
  readonly orgMemberships: readonly SessionOrgMembership[]
  /** The org id from the "compass-active-org" cookie, if any. */
  readonly preferredOrgId: string | null
  /** The roles from the person's project memberships, in query order. */
  readonly projectRoles: readonly string[]
  /** users.role, used when the person has no organization membership. */
  readonly accountRole: string
}

export type SessionRole = {
  readonly role: string
  readonly activeOrg: SessionOrgMembership | null
}

/**
 * - Staff of an internal organization keep their organization role.
 * - Anyone else whose project membership is an outside role (owner, vendor,
 *   guest) gets that role, and their active organization becomes the
 *   internal company they were invited into.
 * - Otherwise the active organization's role, then users.role.
 *
 * Only the first project role counts today, and the project query has no
 * order, so a person who is an owner on one job and a vendor on another can
 * get either (issue #1329). Tests pin this; the fix is its own change.
 */
export function resolveSessionRole(input: SessionRoleInput): SessionRole {
  const { orgMemberships, preferredOrgId, projectRoles, accountRole } = input
  const preferredOrg = orgMemberships.find((membership) => membership.orgId === preferredOrgId)
  const defaultOrg = preferredOrg ?? orgMemberships[0] ?? null

  const isInternalStaff = orgMemberships.some(
    (membership) => membership.orgType === "internal" && !isExternalProjectRole(membership.memberRole),
  )
  const projectRole = projectRoles[0]
  if (isInternalStaff || projectRole === undefined || !isExternalProjectRole(projectRole)) {
    return { role: defaultOrg?.memberRole ?? accountRole, activeOrg: defaultOrg }
  }

  const invitingOrg = orgMemberships.find(
    (membership) => membership.orgType === "internal" && isExternalProjectRole(membership.memberRole),
  )
  return { role: externalOrganizationRole(projectRole), activeOrg: invitingOrg ?? defaultOrg }
}
