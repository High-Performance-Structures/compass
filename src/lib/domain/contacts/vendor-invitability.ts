/**
 * Whether a job contact's company may be invited to Compass, by its vendor
 * type (Settings › Company › Vendor types). A type with no job role can be
 * picked for a job but not invited; owners, staff and contacts with no
 * directory vendor are not limited here.
 */
import { eq } from "drizzle-orm"

import { projectContacts, vendors } from "@/db/schema"
import { vendorCanBeInvited } from "@/lib/contact-project-association"
import { readVendorTypes } from "@/lib/feature-settings/vendor-types-server"
import type { Db } from "@/lib/server/action-context"

/** Null when the contact may be invited, otherwise why not. */
export async function vendorInvitationBlock(db: Db, organizationId: string, projectContactId: string): Promise<string | null> {
  const row = await db
    .select({ name: vendors.name, category: vendors.category })
    .from(projectContacts)
    .innerJoin(vendors, eq(vendors.id, projectContacts.vendorId))
    .where(eq(projectContacts.id, projectContactId))
    .get()
  if (!row || vendorCanBeInvited(row.category, await readVendorTypes(db, organizationId))) return null
  return `${row.name} is a "${row.category}" vendor, a type with no job role, so it can't be invited. Change its vendor type in Contacts (or give "${row.category}" a job role in Settings › Vendor types) to invite them.`
}
