import { asc, desc, eq, inArray } from "drizzle-orm"
import type { getDb } from "@/db"
import { users } from "@/db/schema"
import { recurringDuties, recurringDutyCompletions } from "@/db/schema-internal-duties"
import { chunkD1Values } from "@/lib/d1-query"
import { dutyStatus, type DutyCadence, type DutyStatus } from "@/lib/internal-duties/recurring"

type Db = ReturnType<typeof getDb>

export type RecurringDutyView = {
  readonly id: string
  readonly title: string
  readonly accountName: string | null
  readonly cadence: DutyCadence
  readonly dueDay: number
  readonly dutyCode: string | null
  readonly ownerUserId: string | null
  readonly ownerName: string | null
  readonly active: boolean
  readonly lastDone: { readonly id: string; readonly period: string; readonly completedOn: string } | null
  readonly status: DutyStatus
}

function nameOf(user: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null }): string | null {
  return user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ") || null
}

/** Today's date in the company's time zone (Mountain), YYYY-MM-DD. */
export function companyToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(now)
}

/** A workspace's recurring duties with where each stands today. */
export async function loadRecurringDuties(db: Db, projectId: string, today = companyToday()): Promise<readonly RecurringDutyView[]> {
  const duties = await db
    .select({
      duty: recurringDuties,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(recurringDuties)
    .leftJoin(users, eq(users.id, recurringDuties.ownerUserId))
    .where(eq(recurringDuties.projectId, projectId))
    .orderBy(asc(recurringDuties.sortOrder), asc(recurringDuties.createdAt))
  if (duties.length === 0) return []
  // Chunked to stay under D1's bound-parameter limit; each chunk is sorted
  // newest period first, which is all the per-duty lookup below needs.
  const completionChunks = await Promise.all(
    chunkD1Values(duties.map((row) => row.duty.id)).map((ids) =>
      db
        .select({
          id: recurringDutyCompletions.id,
          dutyId: recurringDutyCompletions.recurringDutyId,
          period: recurringDutyCompletions.period,
          completedOn: recurringDutyCompletions.completedOn,
        })
        .from(recurringDutyCompletions)
        .where(inArray(recurringDutyCompletions.recurringDutyId, ids))
        .orderBy(desc(recurringDutyCompletions.period))
    )
  )
  const completions = completionChunks.flat()
  return duties.map(({ duty, ...owner }) => {
    // Periods sort as text within a cadence ("2026-05" < "2026-06"), so the first is the latest.
    const last = completions.find((completion) => completion.dutyId === duty.id) ?? null
    return {
      id: duty.id,
      title: duty.title,
      accountName: duty.accountName,
      cadence: duty.cadence,
      dueDay: duty.dueDay,
      dutyCode: duty.dutyCode,
      ownerUserId: duty.ownerUserId,
      ownerName: duty.ownerUserId ? nameOf(owner) : null,
      active: duty.active,
      lastDone: last ? { id: last.id, period: last.period, completedOn: last.completedOn } : null,
      status: dutyStatus({ cadence: duty.cadence, dueDay: duty.dueDay, lastDone: last?.period ?? null, today }),
    }
  })
}

/** Behind first (most periods owed), then due soon, then not started; current duties are left out. */
export function dutiesNeedingAttention(duties: readonly RecurringDutyView[]): readonly RecurringDutyView[] {
  const rank = (status: DutyStatus): number =>
    status.kind === "behind" ? 0 : status.kind === "due_soon" ? 1 : status.kind === "not_started" ? 2 : 3
  return duties
    .filter((duty) => duty.active && duty.status.kind !== "current")
    .sort((a, b) => {
      const byRank = rank(a.status) - rank(b.status)
      if (byRank !== 0) return byRank
      const owedA = a.status.kind === "behind" ? a.status.owed.length : 0
      const owedB = b.status.kind === "behind" ? b.status.owed.length : 0
      return owedB - owedA
    })
}
