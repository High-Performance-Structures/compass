import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectContacts } from "@/db/schema"
import {
  buildProjectEmailRecipientOptions,
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
  return buildProjectEmailRecipientOptions(
    rows.map((row) => ({ ...row, contactType: contactType(row.contactType) })),
    recommended
  )
}
