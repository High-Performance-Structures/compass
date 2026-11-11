import { and, eq, inArray, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { internalContacts, projectContacts, userAlternateEmails } from "@/db/schema"
import type { ProjectContactType } from "@/lib/domain/contacts/statuses"
import { notArchivedPersonContact } from "@/lib/domain/contacts/person-status"
import {
  buildProjectEmailRecipientOptions,
  withStaffAlternateEmails,
  type EmailRecipientOption,
  type ProjectEmailContact,
} from "@/lib/email/recipient-options"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

function contactType(value: string): ProjectEmailContact["contactType"] {
  if (value === "owner" || value === "supplier" || value === "subcontractor") return value
  return "internal"
}

/**
 * The project's active contacts as To/Cc choices for the shared recipient
 * picker. Recommended targets (names, companies or emails) are listed first.
 */
export async function projectEmailRecipientOptions(
  db: ReturnType<typeof getDb>,
  projectId: string,
  recommended: readonly (string | null | undefined)[] = [],
  contactTypes?: readonly ProjectContactType[]
): Promise<readonly EmailRecipientOption[]> {
  const rows = await withContactDirectory(db
    .select({
      id: projectContacts.id,
      contactType: projectContacts.contactType,
      displayName: resolvedContactColumns.displayName,
      companyName: resolvedContactColumns.companyName,
      email: resolvedContactColumns.email,
    })
    .from(projectContacts)
    .where(and(
      eq(projectContacts.projectId, projectId),
      eq(projectContacts.active, true),
      notArchivedPersonContact(),
      contactTypes ? inArray(projectContacts.contactType, contactTypes) : undefined,
    )).$dynamic())
  const options = buildProjectEmailRecipientOptions(
    rows.map((row) => ({ ...row, contactType: contactType(row.contactType) })),
    recommended,
  )
  if (contactTypes && !contactTypes.includes("internal")) return options

  const alternates = await withContactDirectory(db
    .select({ contactId: projectContacts.id, displayName: resolvedContactColumns.displayName, email: userAlternateEmails.email })
    .from(projectContacts)
    .leftJoin(internalContacts, eq(internalContacts.id, projectContacts.internalContactId))
    // The staff member is the internal contact's account, or the account a staff row was added from.
    .innerJoin(userAlternateEmails, or(
      eq(userAlternateEmails.userId, internalContacts.userId),
      and(eq(projectContacts.sourceEntityType, "user"), eq(userAlternateEmails.userId, projectContacts.sourceEntityId)),
    ))
    .where(and(
      eq(projectContacts.projectId, projectId),
      eq(projectContacts.active, true),
      eq(projectContacts.contactType, "internal"),
      notArchivedPersonContact(),
      // Only addresses kept by the project's own company.
      sql`${userAlternateEmails.organizationId} = (SELECT organization_id FROM projects WHERE id = ${projectId})`,
    ))
    .limit(200).$dynamic())
  return withStaffAlternateEmails(options, alternates)
}
