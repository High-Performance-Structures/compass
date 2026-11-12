/**
 * Read-only views of the identity tables for queries outside the identity
 * module (issue #1329). A caller that shows or lists people, companies,
 * memberships or invitations joins one of these instead of importing the
 * table, so every read goes through identity and a rule added here (such as
 * hiding de-identified accounts) reaches all of them.
 *
 * Views are for showing and listing. Decide access with projectContext /
 * orgContext (@/lib/server/action-context) or assertProjectAccess, and roles
 * with the predicates in @/lib/user-roles, never by reading a view's role.
 *
 * Read-only by contract: never insert, update or delete through a view; the
 * owning module's store.ts is the only writer. Name the view when one query
 * joins it twice:
 *   const author = peopleView("author")
 *   const assignee = peopleView("assignee")
 */
import { alias } from "drizzle-orm/sqlite-core"

import { organizationMembers, organizations, projectAccessInvitations, users } from "@/db/schema"

/** Signed-in accounts (users): name, emails, phone, avatar, account role, active flag. */
export function peopleView(): typeof users
export function peopleView<const Name extends string>(name: Name): ReturnType<typeof alias<typeof users, Name>>
export function peopleView(name?: string) {
  return name ? alias(users, name) : users
}

/** Companies (organizations): name, slug, type, logo, active flag. */
export function companiesView(): typeof organizations
export function companiesView<const Name extends string>(name: Name): ReturnType<typeof alias<typeof organizations, Name>>
export function companiesView(name?: string) {
  return name ? alias(organizations, name) : organizations
}

/** Company memberships (organization_members): who belongs to which company, with which role. */
export function membershipsView(): typeof organizationMembers
export function membershipsView<const Name extends string>(name: Name): ReturnType<typeof alias<typeof organizationMembers, Name>>
export function membershipsView(name?: string) {
  return name ? alias(organizationMembers, name) : organizationMembers
}

/** Project access invitations: who was invited to which job, their status and email delivery. */
export function invitationsView(): typeof projectAccessInvitations
export function invitationsView<const Name extends string>(name: Name): ReturnType<typeof alias<typeof projectAccessInvitations, Name>>
export function invitationsView(name?: string) {
  return name ? alias(projectAccessInvitations, name) : projectAccessInvitations
}
