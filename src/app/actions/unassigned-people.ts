"use server"

import { listUnassignedPeople, type UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"
import { canFeature } from "@/lib/permission-enforcement"
import { orgContext } from "@/lib/server/action-context"

/** People from imported messages not yet connected to a company (Contacts → Unassigned). */
export async function getUnassignedPeople(): Promise<readonly UnassignedPerson[]> {
  const context = await orgContext()
  if (!context.success) return []
  const { db, user, organizationId } = context.data
  if (!(await canFeature(user, "vendors", "read"))) return []
  return listUnassignedPeople(db, organizationId)
}
