/**
 * The job's selection managers: its active members in the company's chosen
 * project roles (Settings › Selections; by default project manager,
 * assistant project manager, project administrator), however a membership
 * spells the role, plus the project manager named on the job, keeping only
 * the company's staff. In the settings' role order, the named project
 * manager first among project managers. Told about price changes during a
 * signature, and assigned the change-order to-do of a replacement (the
 * first one).
 */
import { namedProjectManager, projectMembersWithRole } from "@/lib/domain/project/member-role"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole, projectRoleMatches } from "@/lib/user-roles"

import { readProjectSelectionSettings } from "./project-settings"

export type SelectionManager = { readonly userId: string; readonly email: string; readonly name: string }

export async function selectionManagers(db: Db, projectId: string): Promise<readonly SelectionManager[]> {
  const { settings } = await readProjectSelectionSettings(db, projectId)
  const roles = settings.priceChangeNoticeRoles
  // Membership roles are free text ("project-manager"); compare however they're spelled.
  const members = await projectMembersWithRole(db, projectId, (role) => projectRoleMatches(role, roles))
  // The project manager named on the job counts as one, even without a membership.
  const named = projectRoleMatches("project_manager", roles) ? await namedProjectManager(db, projectId) : null
  const rank = (role: string): number => {
    const index = roles.findIndex((candidate) => projectRoleMatches(role, [candidate]))
    return index === -1 ? roles.length : index
  }
  const ordered = [
    ...(named ? [{ ...named, rank: rank("project_manager") - 0.5 }] : []),
    ...members.map((member) => ({ ...member, rank: rank(member.role) })),
  ].sort((a, b) => a.rank - b.rank)
  const byUser = new Map<string, SelectionManager>()
  for (const member of ordered) {
    // Only company staff, whatever the setting holds.
    if (!byUser.has(member.userId) && isInternalStaffRole(member.accountRole)) {
      byUser.set(member.userId, { userId: member.userId, email: member.email, name: member.name })
    }
  }
  return [...byUser.values()]
}
