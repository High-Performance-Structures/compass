import { and, asc, eq, isNull } from "drizzle-orm"

import { projectContacts, projects } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * People added from imported (Buildertrend) messages who are not connected to
 * any vendor or customer company yet (owner decision 2026-11-02). Staff find
 * them on the Contacts page and connect each one to the company they work for
 * from the project's contacts. One row per person, keyed by the identity the
 * importer gave them, with every project they appear on.
 */

export type UnassignedPerson = {
  readonly identity: string
  readonly name: string
  readonly email: string | null
  readonly projects: readonly {
    readonly projectId: string
    readonly projectName: string
    readonly projectNumber: string | null
    readonly contactId: string
  }[]
}

/** The importer's source entity type for a person not yet connected to a company. */
const NEW_PERSON_SOURCE = "buildertrend_new_person"
const MAX_ROWS = 2000

export async function listUnassignedPeople(db: Db, organizationId: string): Promise<readonly UnassignedPerson[]> {
  const rows = await db
    .select({
      contactId: projectContacts.id,
      identity: projectContacts.sourceEntityId,
      name: projectContacts.displayName,
      email: projectContacts.email,
      projectId: projects.id,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(projectContacts.sourceEntityType, NEW_PERSON_SOURCE),
        eq(projectContacts.active, true),
        isNull(projectContacts.vendorId),
        isNull(projectContacts.customerId),
      )
    )
    .orderBy(asc(projectContacts.displayName), asc(projects.name))
    .limit(MAX_ROWS)

  const people = new Map<string, { name: string; email: string | null; projects: UnassignedPerson["projects"][number][] }>()
  for (const row of rows) {
    const identity = row.identity ?? row.contactId
    const person = people.get(identity) ?? { name: row.name, email: row.email, projects: [] }
    person.projects.push({ projectId: row.projectId, projectName: row.projectName, projectNumber: row.projectNumber, contactId: row.contactId })
    if (!person.email && row.email) person.email = row.email
    people.set(identity, person)
  }
  return [...people.entries()].map(([identity, person]) => ({ identity, ...person }))
}
