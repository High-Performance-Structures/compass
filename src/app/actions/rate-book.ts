"use server"

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { projectEstimateLineCostItems } from "@/db/schema-estimates"
import { rateBookEntries, rateBookEntryHistory } from "@/db/schema-rate-book"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canEditTravelCharges } from "@/lib/portfolio-map/travel-zones"
import {
  entryChanged,
  RATE_BOOK_CATEGORY_LABEL,
  rateBookEntryInputSchema,
  type RateBookEntryInput,
} from "@/lib/rate-book/model"
import { getProjectTravelCharge } from "@/app/actions/project-travel-charges"
import { isInternalStaffRole } from "@/lib/user-roles"

export type RateBookEntry = RateBookEntryInput & {
  readonly id: string
  readonly status: "active" | "retired"
  readonly version: number
  readonly updatedAt: string
  /** Estimate cost items filled from this entry (any version). */
  readonly usageCount: number
}

export type RateBookHistoryItem = {
  readonly version: number
  readonly snapshot: RateBookEntryInput
  readonly changeNote: string | null
  readonly changedAt: string
  readonly changedByName: string | null
}

type ActionResult<T = null> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

type Db = ReturnType<typeof getDb>

/** Office staff read; the zone-charge editors (admins, owners, office manager, project administrators, estimators) edit. */
async function access(): Promise<
  | { readonly ok: true; readonly db: Db; readonly organizationId: string; readonly userId: string; readonly canEdit: boolean }
  | { readonly ok: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user?.organizationId || !isInternalStaffRole(user.role)) {
    return { ok: false, error: "The rate book is available to office staff." }
  }
  const { env } = await getCloudflareContext()
  if (!env?.DB) return { ok: false, error: "The database is not available." }
  return {
    ok: true,
    db: getDb(env.DB),
    organizationId: user.organizationId,
    userId: user.id,
    canEdit: user.isActive && canEditTravelCharges(user.role) && !isDemoUser(user.id) && !isDemoOrg(user.organizationId),
  }
}

function toInput(row: typeof rateBookEntries.$inferSelect): RateBookEntryInput {
  return {
    name: row.name,
    category: row.category,
    unit: row.unit,
    unitCostCents: row.unitCostCents,
    markupBasisPoints: row.markupBasisPoints,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    costCode: row.costCode,
    costCodeName: row.costCodeName,
    fuelType: row.fuelType,
    fuelGallonsPerUnit: row.fuelGallonsPerUnit,
    notes: row.notes,
  }
}

async function findEntry(db: Db, organizationId: string, entryId: string) {
  return db
    .select()
    .from(rateBookEntries)
    .where(and(eq(rateBookEntries.id, entryId), eq(rateBookEntries.organizationId, organizationId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

function failure(error: unknown, fallback: string): { readonly success: false; readonly error: string } {
  console.error(fallback, error)
  return { success: false, error: fallback }
}

export async function listRateBookEntries(): Promise<
  ActionResult<{ readonly entries: readonly RateBookEntry[]; readonly canEdit: boolean }>
> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    const usage = context.db
      .select({
        entryId: projectEstimateLineCostItems.rateBookEntryId,
        count: sql<number>`count(*)`.as("usage_count"),
      })
      .from(projectEstimateLineCostItems)
      .where(isNull(projectEstimateLineCostItems.deletedAt))
      .groupBy(projectEstimateLineCostItems.rateBookEntryId)
      .as("usage")
    const rows = await context.db
      .select({ entry: rateBookEntries, usageCount: usage.count })
      .from(rateBookEntries)
      .leftJoin(usage, eq(usage.entryId, rateBookEntries.id))
      .where(eq(rateBookEntries.organizationId, context.organizationId))
      .orderBy(asc(rateBookEntries.category), asc(rateBookEntries.name))
    return {
      success: true,
      data: {
        canEdit: context.canEdit,
        entries: rows.map(({ entry, usageCount }) => ({
          ...toInput(entry),
          id: entry.id,
          status: entry.status,
          version: entry.version,
          updatedAt: entry.updatedAt,
          usageCount: Number(usageCount ?? 0),
        })),
      },
    }
  } catch (error) {
    return failure(error, "The rate book could not be loaded.")
  }
}

export async function createRateBookEntry(input: unknown): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change the rate book." }
    const parsed = rateBookEntryInputSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the rate details." }
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await context.db.batch([
      context.db.insert(rateBookEntries).values({
        id,
        organizationId: context.organizationId,
        ...parsed.data,
        status: "active",
        version: 1,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
      }),
      context.db.insert(rateBookEntryHistory).values({
        id: crypto.randomUUID(),
        entryId: id,
        organizationId: context.organizationId,
        version: 1,
        snapshotJson: JSON.stringify(parsed.data),
        changeNote: "Added",
        changedAt: now,
        changedBy: context.userId,
      }),
    ])
    revalidatePath("/dashboard/settings")
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "The rate could not be added.")
  }
}

/** Saves a new version; the previous values stay in the history. */
export async function updateRateBookEntry(
  entryId: string,
  input: unknown,
  changeNote: string | null,
): Promise<ActionResult> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change the rate book." }
    const parsed = rateBookEntryInputSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the rate details." }
    const existing = await findEntry(context.db, context.organizationId, entryId)
    if (!existing) return { success: false, error: "That rate no longer exists." }
    if (!entryChanged(toInput(existing), parsed.data)) return { success: true, data: null }
    const version = existing.version + 1
    const now = new Date().toISOString()
    const note = typeof changeNote === "string" && changeNote.trim() ? changeNote.trim().slice(0, 300) : null
    await context.db.batch([
      context.db
        .update(rateBookEntries)
        .set({ ...parsed.data, version, updatedAt: now, updatedBy: context.userId })
        .where(and(eq(rateBookEntries.id, entryId), eq(rateBookEntries.organizationId, context.organizationId))),
      context.db.insert(rateBookEntryHistory).values({
        id: crypto.randomUUID(),
        entryId,
        organizationId: context.organizationId,
        version,
        snapshotJson: JSON.stringify(parsed.data),
        changeNote: note,
        changedAt: now,
        changedBy: context.userId,
      }),
    ])
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "The rate could not be saved.")
  }
}

/** Retired rates stay in the book and in old estimates but leave the picker. */
export async function setRateBookEntryStatus(entryId: string, status: "active" | "retired"): Promise<ActionResult> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change the rate book." }
    if (status !== "active" && status !== "retired") return { success: false, error: "Choose active or retired." }
    const existing = await findEntry(context.db, context.organizationId, entryId)
    if (!existing) return { success: false, error: "That rate no longer exists." }
    if (existing.status === status) return { success: true, data: null }
    const now = new Date().toISOString()
    await context.db.batch([
      context.db
        .update(rateBookEntries)
        .set({ status, updatedAt: now, updatedBy: context.userId })
        .where(and(eq(rateBookEntries.id, entryId), eq(rateBookEntries.organizationId, context.organizationId))),
      context.db.insert(rateBookEntryHistory).values({
        id: crypto.randomUUID(),
        entryId,
        organizationId: context.organizationId,
        version: existing.version,
        snapshotJson: JSON.stringify(toInput(existing)),
        changeNote: status === "retired" ? "Retired" : "Restored",
        changedAt: now,
        changedBy: context.userId,
      }),
    ])
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "The rate could not be updated.")
  }
}

/**
 * Permanent delete, only for rates no estimate has used; used rates are
 * retired instead so estimates keep their trail.
 */
export async function deleteRateBookEntry(entryId: string): Promise<ActionResult> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change the rate book." }
    const existing = await findEntry(context.db, context.organizationId, entryId)
    if (!existing) return { success: true, data: null }
    const used = await context.db
      .select({ id: projectEstimateLineCostItems.id })
      .from(projectEstimateLineCostItems)
      .where(eq(projectEstimateLineCostItems.rateBookEntryId, entryId))
      .limit(1)
    if (used.length > 0) {
      return { success: false, error: "Estimates use this rate. Retire it instead so they keep their history." }
    }
    await context.db
      .delete(rateBookEntries)
      .where(and(eq(rateBookEntries.id, entryId), eq(rateBookEntries.organizationId, context.organizationId)))
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "The rate could not be deleted.")
  }
}

export async function getRateBookHistory(entryId: string): Promise<ActionResult<readonly RateBookHistoryItem[]>> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    const rows = await context.db
      .select({
        version: rateBookEntryHistory.version,
        snapshotJson: rateBookEntryHistory.snapshotJson,
        changeNote: rateBookEntryHistory.changeNote,
        changedAt: rateBookEntryHistory.changedAt,
        changedByName: users.displayName,
      })
      .from(rateBookEntryHistory)
      .leftJoin(users, eq(users.id, rateBookEntryHistory.changedBy))
      .where(
        and(
          eq(rateBookEntryHistory.entryId, entryId),
          eq(rateBookEntryHistory.organizationId, context.organizationId),
        ),
      )
      .orderBy(desc(rateBookEntryHistory.changedAt))
      .limit(100)
    return {
      success: true,
      data: rows.flatMap((row) => {
        try {
          const snapshot = rateBookEntryInputSchema.safeParse(JSON.parse(row.snapshotJson))
          if (!snapshot.success) return []
          return [{
            version: row.version,
            snapshot: snapshot.data,
            changeNote: row.changeNote,
            changedAt: row.changedAt,
            changedByName: row.changedByName,
          }]
        } catch {
          return []
        }
      }),
    }
  } catch (error) {
    return failure(error, "The rate history could not be loaded.")
  }
}

export type RateBookPickerOption = {
  /** Rate book entry id, or a "job:" id for this job's zone charges (not stored). */
  readonly id: string
  readonly entryId: string | null
  readonly version: number | null
  readonly label: string
  readonly group: string
  readonly description: string
  readonly unit: string
  readonly unitCostCents: number
  readonly markupBasisPoints: number
  readonly costCode: string | null
}

/**
 * Choices for an estimate's "From rate book" picker: active rates, plus this
 * job's zone, mountain, lodging and per diem charges (with any per-job
 * adjustments), so travel isn't typed in twice.
 */
export async function getRateBookPicker(projectId: string): Promise<ActionResult<readonly RateBookPickerOption[]>> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    const rows = await context.db
      .select()
      .from(rateBookEntries)
      .where(and(eq(rateBookEntries.organizationId, context.organizationId), eq(rateBookEntries.status, "active")))
      .orderBy(asc(rateBookEntries.category), asc(rateBookEntries.name))
    const options: RateBookPickerOption[] = rows.map((row) => ({
      id: row.id,
      entryId: row.id,
      version: row.version,
      label: row.name,
      group: RATE_BOOK_CATEGORY_LABEL[row.category],
      description: row.name,
      unit: row.unit,
      unitCostCents: row.unitCostCents,
      markupBasisPoints: row.markupBasisPoints,
      costCode: row.costCode,
    }))
    const travel = await getProjectTravelCharge(projectId).catch(() => null)
    const charge = travel?.effective
    if (charge) {
      const job = (id: string, label: string, unit: string, cents: number | null): void => {
        if (cents === null || cents <= 0) return
        options.push({
          id: `job:${id}`,
          entryId: null,
          version: null,
          label,
          group: "This job's zone charges",
          description: label,
          unit,
          unitCostCents: cents,
          markupBasisPoints: 0,
          costCode: null,
        })
      }
      job("zone", `Zone ${charge.zone} travel charge`, "man-hr", charge.zoneRateCents)
      if (charge.mountainBand !== null) {
        job("mountain", `Mountain charge (band ${charge.mountainBand})`, "man-hr", charge.mountainRateCents)
      }
      if (charge.lodgingAndPerDiem) {
        job("lodging", "Lodging", "night", charge.lodgingPerNightCents)
        job("per-diem", "Per diem", "day", charge.perDiemPerDayCents)
      }
    }
    return { success: true, data: options }
  } catch (error) {
    return failure(error, "The rate book could not be loaded.")
  }
}
