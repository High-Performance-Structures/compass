import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { internalContacts } from "@/db/schema"
import { companiesView } from "@/lib/domain/identity/views"
import { insertInternalContactIfMissing } from "@/lib/domain/contacts/store"
import { isInternalStaffRole } from "@/lib/user-roles"

const companies = companiesView()

/** Provision a directory identity once; later profile edits do not overwrite Sage-owned fields. */
export async function ensureInternalContactForStaff(
  db: ReturnType<typeof getDb>,
  input: {
    readonly organizationId: string
    readonly userId: string
    readonly role: string
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }
): Promise<void> {
  if (!isInternalStaffRole(input.role)) return
  const organization = await db
    .select({ type: companies.type })
    .from(companies)
    .where(eq(companies.id, input.organizationId))
    .get()
  if (organization?.type !== "internal") return

  const existing = await db
    .select({ id: internalContacts.id })
    .from(internalContacts)
    .where(
      and(
        eq(internalContacts.organizationId, input.organizationId),
        eq(internalContacts.userId, input.userId)
      )
    )
    .get()
  if (existing) return

  const now = new Date().toISOString()
  await insertInternalContactIfMissing(db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId: input.userId,
    name: input.name.trim() || input.email,
    email: input.email.trim().toLowerCase(),
    phone: input.phone,
    sourceSystem: "compass_user",
    sourceRecordId: input.userId,
    active: true,
    syncStatus: "manual",
    createdAt: now,
    updatedAt: now,
  })
}
