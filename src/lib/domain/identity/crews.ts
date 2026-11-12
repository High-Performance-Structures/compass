/**
 * Crews (issue #1329 Core: the identity module owns teams and team_members).
 * A crew is a team of the company's own staff, with the department whose work
 * it does and an optional lead. Schedule items can be assigned to a crew;
 * everyone on it is then assigned. Every read and write of the two tables
 * outside this module goes through the functions here; the writes are
 * saveCrew and deleteCrew in ./store.
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import { teamMembers, teams } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import { PROJECT_DEPARTMENTS, type ProjectDepartmentCode } from "@/lib/domain/project/statuses"
import type { Db } from "@/lib/server/action-context"
import { isListValue } from "@/lib/shared/statuses"

export type Crew = {
  readonly id: string
  readonly name: string
  readonly department: ProjectDepartmentCode | null
  readonly leadUserId: string | null
  readonly memberIds: readonly string[]
}

export type CrewInput = {
  readonly name: string
  readonly department: ProjectDepartmentCode | null
  readonly leadUserId: string | null
  readonly memberIds: readonly string[]
}

const CREW_NAME_MAX = 60
const CREW_MEMBERS_MAX = 50

/** Why a crew can't be saved, or null. `staffIds` are the company's active staff. */
export function crewInputProblem(input: CrewInput, staffIds: ReadonlySet<string>): string | null {
  const name = input.name.trim()
  if (!name) return "Give the crew a name."
  if (name.length > CREW_NAME_MAX) return `Keep the crew name under ${CREW_NAME_MAX} characters.`
  if (input.department !== null && !isListValue(PROJECT_DEPARTMENTS, input.department)) return "Pick a department."
  if (input.memberIds.length > CREW_MEMBERS_MAX) return `A crew can have at most ${CREW_MEMBERS_MAX} people.`
  if (input.memberIds.some((id) => !staffIds.has(id))) return "Crews are for your own staff only."
  if (input.leadUserId !== null && !input.memberIds.includes(input.leadUserId)) return "The crew lead must be on the crew."
  return null
}

/** Every crew in the company with its members, by name. */
export async function listCrews(db: Db, organizationId: string): Promise<Crew[]> {
  const [crewRows, memberRows] = await db.batch([
    db
      .select({ id: teams.id, name: teams.name, department: teams.department, leadUserId: teams.leadUserId })
      .from(teams)
      .where(eq(teams.organizationId, organizationId))
      .orderBy(asc(teams.name)),
    db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.organizationId, organizationId)),
  ])
  const members = groupMembers(memberRows)
  return crewRows.map((crew) => ({ ...crew, memberIds: members.get(crew.id) ?? [] }))
}

/** Members of each crew, for expanding crew assignments into people. */
export async function crewMemberIds(db: Db, crewIds: readonly string[]): Promise<Map<string, readonly string[]>> {
  if (crewIds.length === 0) return new Map()
  const rows = (
    await Promise.all(
      chunkD1Values([...new Set(crewIds)]).map((chunk) =>
        db
          .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
          .from(teamMembers)
          .where(inArray(teamMembers.teamId, chunk)),
      ),
    )
  ).flat()
  return groupMembers(rows)
}

/** The crews each listed person is on, for the People table. */
export async function crewsForUsers(
  db: Db,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, { readonly id: string; readonly name: string }[]>> {
  const byUser = new Map<string, { readonly id: string; readonly name: string }[]>()
  for (const chunk of chunkD1Values([...new Set(userIds)])) {
    const rows = await db
      .select({ userId: teamMembers.userId, id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.organizationId, organizationId), inArray(teamMembers.userId, chunk)))
      .orderBy(asc(teams.name))
    for (const { userId, id, name } of rows) byUser.set(userId, [...(byUser.get(userId) ?? []), { id, name }])
  }
  return byUser
}

/** The ids of the crews a person is on, as a subquery (permission overrides). */
export function crewIdsForUserSubquery(db: Db, userId: string) {
  return db.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId))
}

/** Every crew's id and name, unexecuted so callers can batch it. */
export function crewOptionsQuery(db: Db, organizationId: string) {
  return db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.organizationId, organizationId)).orderBy(asc(teams.name))
}

/** True when the crew belongs to the company. */
export async function crewExists(db: Db, organizationId: string, crewId: string): Promise<boolean> {
  const row = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, crewId), eq(teams.organizationId, organizationId)))
    .get()
  return row !== undefined
}

function groupMembers(rows: readonly { readonly teamId: string; readonly userId: string }[]): Map<string, readonly string[]> {
  const byCrew = new Map<string, string[]>()
  for (const { teamId, userId } of rows) byCrew.set(teamId, [...(byCrew.get(teamId) ?? []), userId])
  return byCrew
}
