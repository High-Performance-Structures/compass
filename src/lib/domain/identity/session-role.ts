/**
 * The one rule that decides a signed-in person's role and active
 * organization (issue #1329, phase 1). Pure: auth reads the memberships and
 * the active-org cookie, this decides. Every page, action and permission
 * check sees the result as `AuthUser.role` / `AuthUser.organizationId`.
 */
import { isExternalProjectRole } from "@/lib/user-roles"

import { externalOrganizationRole } from "./rules"

/**
 * Highest first. A vendor who hires the company for their own job stays in
 * their vendor role, so vendor roles win over owner ("owner" / "client").
 */
const OUTSIDE_ROLE_PRECEDENCE = ["subcontractor", "supplier", "owner", "client", "guest"] as const

/** The outside role that decides the portal, or undefined if none. */
function governingOutsideRole(projectRoles: readonly string[]): string | undefined {
  const outsideRoles = projectRoles.filter(isExternalProjectRole)
  const rank = (role: string): number => {
    const index = OUTSIDE_ROLE_PRECEDENCE.findIndex((candidate) => candidate === role)
    return index === -1 ? OUTSIDE_ROLE_PRECEDENCE.length : index
  }
  return [...outsideRoles].sort((a, b) => rank(a) - rank(b))[0]
}

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
  /** The roles from the person's project memberships, in any order. */
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
 * A person can hold different outside roles on different jobs. The highest
 * in OUTSIDE_ROLE_PRECEDENCE wins, so a vendor who is also an owner on one
 * job always signs in as the vendor (issue #1329). Project access is still
 * checked per project; this only picks their portal.
 */
export function resolveSessionRole(input: SessionRoleInput): SessionRole {
  const { orgMemberships, preferredOrgId, projectRoles, accountRole } = input
  const preferredOrg = orgMemberships.find((membership) => membership.orgId === preferredOrgId)
  const defaultOrg = preferredOrg ?? orgMemberships[0] ?? null

  const isInternalStaff = orgMemberships.some(
    (membership) => membership.orgType === "internal" && !isExternalProjectRole(membership.memberRole),
  )
  const projectRole = governingOutsideRole(projectRoles)
  if (isInternalStaff || projectRole === undefined) {
    return { role: defaultOrg?.memberRole ?? accountRole, activeOrg: defaultOrg }
  }

  const invitingOrg = orgMemberships.find(
    (membership) => membership.orgType === "internal" && isExternalProjectRole(membership.memberRole),
  )
  return { role: externalOrganizationRole(projectRole), activeOrg: invitingOrg ?? defaultOrg }
}
