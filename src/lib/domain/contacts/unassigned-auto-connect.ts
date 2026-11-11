import { and, eq } from "drizzle-orm"

import { projectContacts, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { loadMatchDirectory } from "@/lib/domain/conversations/participant-auto-resolve"
import type { Db } from "@/lib/server/action-context"

import { ALREADY_CONNECTED, connectUnassignedPerson } from "./connect-unassigned-person"
import { planUnassigned, summarizeUnassignedPlan, type UnassignedPlanSummary } from "./unassigned-matching"
import { unassignedPersonWhere } from "./unassigned-people"
import { resolvedContactColumns, withContactDirectory } from "./resolved-columns"

/*
 * "Connect automatically…" on Contacts → Unassigned (owner decision
 * 2026-11-08): every person the matcher ties clearly to one vendor or client
 * is connected through the same write path as "Connect to company…"
 * (connectUnassignedPerson), once per importer identity, so duplicates end on
 * one company person. Legal-hold projects are skipped unless staff include
 * them (`includeStaffOnlyProjects`, default off; their imported
 * conversations stay staff-only). Staff and unclear
 * people stay in Unassigned. Nobody is invited, notified or emailed.
 *
 * Connecting runs several reads and writes per person, so one call handles a
 * bounded number of people; the caller repeats until nothing is left.
 */

const PEOPLE_PER_CALL = 25

type UnassignedAutoConnectExample = {
  readonly name: string
  readonly company: string
  readonly matchType: string
  readonly identities: number
}

export type UnassignedAutoConnectResult = {
  readonly summary: UnassignedPlanSummary
  readonly examples: readonly UnassignedAutoConnectExample[]
  /** Apply only: people connected in this call, and those that failed (with why). */
  readonly connectedPeople: number
  readonly connectedContacts: number
  readonly failed: readonly { readonly name: string; readonly error: string }[]
  /** Apply only: clear matches still waiting for another call. */
  readonly remaining: number
  /** People this call could not fully connect; pass them back so the next call skips them. */
  readonly skippedKeys: readonly string[]
  /** Apply only: projects whose contacts changed. */
  readonly projectIds: readonly string[]
}

type Scope = { readonly db: Db; readonly user: AuthUser; readonly organizationId: string }

async function loadRows(db: Db, organizationId: string): Promise<Parameters<typeof planUnassigned>[1]> {
  return withContactDirectory(db
    .select({
      contactId: projectContacts.id, identity: projectContacts.sourceEntityId, name: resolvedContactColumns.displayName,
      email: resolvedContactColumns.email, projectId: projectContacts.projectId, staffOnly: projects.importedConversationsStaffOnly,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(and(eq(projects.organizationId, organizationId), unassignedPersonWhere(organizationId)))
    .limit(5000).$dynamic(), organizationId)
}

export async function runUnassignedAutoConnect(
  scope: Scope,
  input: { readonly apply: boolean; readonly skipped: readonly string[]; readonly includeStaffOnlyProjects: boolean },
): Promise<UnassignedAutoConnectResult> {
  const { db, organizationId } = scope
  const include = input.includeStaffOnlyProjects
  const [built, loaded] = await Promise.all([loadMatchDirectory(db, organizationId, true), loadRows(db, organizationId)])
  // Included staff-only projects count as writable; nothing about their conversations changes.
  const rows = include ? loaded.map((row) => ({ ...row, staffOnly: false })) : loaded
  const plan = planUnassigned(built, rows)
  const summary = summarizeUnassignedPlan(plan)
  const clear = plan.filter((group) => group.result.kind === "connect" && group.legalHoldRows < group.rows)
  const examples = clear
    .flatMap((group) => (group.result.kind === "connect"
      ? [{ name: group.email ?? group.name, company: group.result.companyName, matchType: group.result.matchType, identities: group.identities.length }]
      : []))
    .slice(0, 50)
  const base = { summary, examples, connectedPeople: 0, connectedContacts: 0, failed: [], remaining: clear.length, skippedKeys: [], projectIds: [] }
  if (!input.apply) return base

  // People a previous call could not connect are skipped so the run ends.
  const skipped = new Set(input.skipped)
  const todo = clear.filter((group) => !skipped.has(group.key))
  const batch = todo.slice(0, PEOPLE_PER_CALL)
  const failed: { name: string; error: string; key: string }[] = []
  let connectedPeople = 0
  let connectedContacts = 0
  const projectIds = new Set<string>()
  for (const group of batch) {
    if (group.result.kind !== "connect") continue
    let personId = group.result.personId
    let any = false
    // One identity at a time; the first creates (or finds) the company person and the rest reuse it.
    for (const identity of group.identities) {
      const result = await connectUnassignedPerson(scope, { identity, kind: group.result.companyKind, companyId: group.result.companyId }, { personId, skipStaffOnlyProjects: !include })
      // Every row of this identity is on a legal-hold project: nothing to do here.
      if (!result.success && result.error === ALREADY_CONNECTED) continue
      if (!result.success) {
        failed.push({ name: group.email ?? group.name, error: result.error, key: group.key })
        continue
      }
      personId = result.data.personId ?? personId
      connectedContacts += result.data.connected.length
      for (const row of result.data.connected) projectIds.add(row.projectId)
      any = any || result.data.connected.length > 0
      for (const row of result.data.failed) failed.push({ name: group.email ?? group.name, error: row.error, key: group.key })
    }
    if (any) connectedPeople += 1
  }
  return {
    ...base,
    connectedPeople,
    connectedContacts,
    failed: failed.map(({ name, error }) => ({ name, error })),
    remaining: Math.max(todo.length - batch.length, 0),
    projectIds: [...projectIds],
    skippedKeys: [...skipped, ...new Set(failed.map((item) => item.key))],
  }
}
