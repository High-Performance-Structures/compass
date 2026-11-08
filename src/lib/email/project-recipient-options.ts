import { and, eq, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { internalContacts, projectContacts, userAlternateEmails } from "@/db/schema"
import {
  buildProjectEmailRecipientOptions,
  withStaffAlternateEmails,
  type EmailRecipientOption,
  type ProjectEmailContact,
} from "@/lib/email/recipient-options"

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
  recommended: readonly (string | null | undefined)[] = []
): Promise<readonly EmailRecipientOption[]> {
  const rows = await db
    .select({
      id: projectContacts.id,
      contactType: projectContacts.contactType,
      displayName: projectContacts.displayName,
      companyName: projectContacts.companyName,
      email: projectContacts.email,
    })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
  const alternates = await db
    .select({ contactId: projectContacts.id, displayName: projectContacts.displayName, email: userAlternateEmails.email })
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
      // Only addresses kept by the project's own company.
      sql`${userAlternateEmails.organizationId} = (SELECT organization_id FROM projects WHERE id = ${projectId})`,
    ))
    .limit(200)
  return withStaffAlternateEmails(
    buildProjectEmailRecipientOptions(
      rows.map((row) => ({ ...row, contactType: contactType(row.contactType) })),
      recommended
    ),
    alternates
  )
}
