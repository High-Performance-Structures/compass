/**
 * Read-only view of project_members for queries outside the project module
 * (issue #1329): who has a login on which job, with their project role.
 *
 * For showing and listing only. Whether someone may open a job is decided by
 * projectContext (@/lib/server/action-context) or assertProjectAccess, and
 * which portal a role gets by the predicates in @/lib/user-roles.
 */
import { alias } from "drizzle-orm/sqlite-core"

import { projectMembers } from "@/db/schema"

/** Project memberships: project, user, project role, when they joined. Read-only; name it to join it twice. */
export function projectMembersView(): typeof projectMembers
export function projectMembersView<const Name extends string>(name: Name): ReturnType<typeof alias<typeof projectMembers, Name>>
export function projectMembersView(name?: string) {
  return name ? alias(projectMembers, name) : projectMembers
}
