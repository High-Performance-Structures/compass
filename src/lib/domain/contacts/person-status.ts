/**
 * Contacts domain: one rule for whether the person behind a project contact
 * is still current. Read only; nothing here changes data.
 *
 * - "current_staff": internal staff of the project's own company. They reach
 *   every company job through organization scope (`usesOrganizationProjectScope`
 *   in `src/lib/domain/project/access.ts`), so they need no project invitation.
 * - "archived_person": the person was removed from Contacts (their internal,
 *   client or vendor directory record is archived), or an internal contact
 *   whose Compass account is inactive or no longer in the company. Their job
 *   rows stay as history but are folded out of current contacts and pickers.
 * - null: everyone else, unchanged.
 *
 * An internal contact's Compass account is matched the same ways the Contacts
 * panel matches it: the contact's email, the user it was added from
 * (`source_entity_type = 'user'`), or its internal directory record (that
 * record's user link or email). Rows linked to a directory record and older
 * unlinked rows (Buildertrend imports) are both handled.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import { USER_ROLES } from "@/lib/domain/identity/statuses"
import { isInternalStaffRole } from "@/lib/user-roles"

import { contactDirectoryRecordReachable } from "./resolved-columns"

export type ProjectContactPersonStatus = "current_staff" | "archived_person"

// Company types whose staff run jobs (`isStaffOrganizationType`): a demo
// company stands in for a real one.
const STAFF_ORGANIZATION_TYPES = ["internal", "demo"] as const

function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )
}

/**
 * Users rows matching the current project_contacts row (correlated, alias u).
 * The email copied onto the job contact counts only when the row names no
 * reachable directory record; otherwise the record's own email does (see
 * resolved-columns.ts).
 */
function matchedAccountWhere(): SQL {
  return sql`(
    (${projectContacts.sourceEntityType} = 'user' and u.id = ${projectContacts.sourceEntityId})
    or u.id = (
      select ic.user_id from internal_contacts ic where ic.id = ${projectContacts.internalContactId}
    )
    or (
      trim(coalesce(${projectContacts.email}, '')) <> ''
      and lower(trim(u.email)) = lower(trim(${projectContacts.email}))
      and not ${contactDirectoryRecordReachable()}
    )
    or lower(trim(u.email)) = (
      select lower(trim(ic.email)) from internal_contacts ic
      where ic.id = ${projectContacts.internalContactId} and trim(coalesce(ic.email, '')) <> ''
    )
    or lower(trim(u.email)) = (
      select lower(trim(cc.email)) from customer_contacts cc
      where cc.id = ${projectContacts.customerContactId} and trim(coalesce(cc.email, '')) <> ''
    )
    or lower(trim(u.email)) = (
      select lower(trim(vc.email)) from vendor_contacts vc
      where vc.id = ${projectContacts.vendorContactId} and trim(coalesce(vc.email, '')) <> ''
    )
  )`
}

/** The project's own company id (correlated with the project_contacts row). */
function projectOrganizationId(): SQL {
  return sql`(select p.organization_id from projects p where p.id = ${projectContacts.projectId})`
}

/** The row's linked directory person was archived in Contacts. */
function archivedDirectoryPerson(): SQL {
  return sql`(
    exists (select 1 from internal_contacts ic where ic.id = ${projectContacts.internalContactId} and ic.active = 0)
    or exists (select 1 from customer_contacts cc where cc.id = ${projectContacts.customerContactId} and cc.active = 0)
    or exists (select 1 from vendor_contacts vc where vc.id = ${projectContacts.vendorContactId} and vc.active = 0)
  )`
}

/**
 * SQL expression for a `project_contacts` row: 'current_staff',
 * 'archived_person' or null (see the file comment). Use it in a query that
 * reads from `project_contacts`.
 */
export function projectContactPersonStatusSql(): SQL<ProjectContactPersonStatus | null> {
  const organizationId = projectOrganizationId()
  return sql<ProjectContactPersonStatus | null>`case
    when ${archivedDirectoryPerson()} then 'archived_person'
    when ${projectContacts.contactType} <> 'internal' then null
    when exists (
      select 1 from users u
      where ${matchedAccountWhere()}
        and u.is_active = 1
        and exists (
          select 1 from organization_members om
          where om.user_id = u.id
            and om.organization_id = ${organizationId}
            and om.role in (${sqlList(USER_ROLES.filter(isInternalStaffRole))})
        )
        and exists (
          select 1 from organizations o
          where o.id = ${organizationId} and o.type in (${sqlList(STAFF_ORGANIZATION_TYPES)})
        )
    ) then 'current_staff'
    when exists (select 1 from users u where ${matchedAccountWhere()})
      and not exists (
        select 1 from users u
        where ${matchedAccountWhere()}
          and u.is_active = 1
          and exists (
            select 1 from organization_members om
            where om.user_id = u.id and om.organization_id = ${organizationId}
          )
      ) then 'archived_person'
    else null
  end`
}

/**
 * WHERE condition that drops archived people (former staff, people removed
 * from Contacts) from a `project_contacts` read. Add it to every query that
 * offers a project's contacts for picking (assignees, message and email
 * recipients, signers).
 */
export function notArchivedPersonContact(): SQL {
  return sql`coalesce(${projectContactPersonStatusSql()}, '') <> 'archived_person'`
}

/** A directory person: an internal (staff), client or vendor contact. */
export type DirectoryPersonKind = "internal_contact" | "customer_contact" | "vendor_contact"

/** Project-contact rows that name a directory person, by link column or by provenance. */
export function directoryPersonProjectContactsWhere(kind: DirectoryPersonKind, personIds: readonly string[]): SQL | undefined {
  const ids = [...personIds]
  const column =
    kind === "internal_contact"
      ? projectContacts.internalContactId
      : kind === "customer_contact"
        ? projectContacts.customerContactId
        : projectContacts.vendorContactId
  return or(
    inArray(column, ids),
    and(eq(projectContacts.sourceEntityType, kind), inArray(projectContacts.sourceEntityId, ids))
  )
}
