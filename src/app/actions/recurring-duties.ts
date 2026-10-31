"use server"

import { and, eq, max } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { projects } from "@/db/schema"
import { recurringDuties, recurringDutyCompletions } from "@/db/schema-internal-duties"
import { isDemoUser } from "@/lib/demo"
import { isUniqueConflict, nextRecurringDutySortOrder, recurringDoneEntryNote } from "@/lib/domain/duties/rules"
import {
  deleteDutyEntry,
  deleteRecurringDuty as deleteRecurringDutyRow,
  deleteRecurringDutyCompletion,
  insertDutyEntry,
  insertRecurringDuty,
  insertRecurringDutyCompletion,
  updateRecurringDuty,
} from "@/lib/domain/duties/store"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { dutiesFor, parseHours } from "@/lib/internal-duties/model"
import { periodEndIndex, periodLabel } from "@/lib/internal-duties/recurring"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { orgContext, type Db } from "@/lib/server/action-context"

const FEATURE = "internal-duties"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/**
 * Staff of the workspace's own organization with update permission. The
 * demo check keeps its own message, so it is not the context's mutation flag.
 */
async function context(projectId: string) {
  const ctx = await orgContext()
  if (!ctx.success) throw new Error(ctx.error)
  const { user, organizationId: orgId, db } = ctx.data
  if (isDemoUser(user.id)) throw new Error("The demo account can't change recurring duties.")
  await requireFeaturePermission(user, FEATURE, "update")
  const [project] = await db
    .select({ id: projects.id, workspaceKind: projects.workspaceKind })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)
  if (!project?.workspaceKind) throw new Error("This project isn't an internal workspace.")
  return { db, user, orgId, workspaceKind: project.workspaceKind }
}

async function dutyFor(db: Db, projectId: string, dutyId: string) {
  const [duty] = await db
    .select()
    .from(recurringDuties)
    .where(and(eq(recurringDuties.id, dutyId), eq(recurringDuties.projectId, projectId)))
    .limit(1)
  return duty ?? null
}

function failure(error: unknown): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : "Couldn't save the recurring duty." }
}

function revalidate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/duty-log`)
  revalidatePath(`/dashboard/projects/${projectId}`)
}

const doneSchema = z.object({
  period: z.string().max(10),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was done."),
  hours: z.string().max(10),
  notes: z.string().max(2000),
})

export type RecurringDoneInput = z.infer<typeof doneSchema>

/**
 * Marks one period done. Hours, when given, go on the duty log under the
 * duty's cost code, so the work is counted once.
 */
export async function markRecurringDutyDone(projectId: string, dutyId: string, raw: RecurringDoneInput): Promise<Result<null>> {
  try {
    const { db, user, orgId, workspaceKind } = await context(projectId)
    const parsed = doneSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the details." }
    const input = parsed.data
    const duty = await dutyFor(db, projectId, dutyId)
    if (!duty) return { success: false, error: "That recurring duty no longer exists." }
    if (periodEndIndex(input.period) === null) return { success: false, error: "Choose the period that was done." }
    const hours = parseHours(input.hours)
    if (!hours.ok) return { success: false, error: hours.error }
    const now = new Date().toISOString()
    let dutyEntryId: string | null = null
    if (hours.hours !== null && duty.dutyCode) {
      const settings = await readFeatureSettings(db, orgId, "internal-duties")
      const option = dutiesFor(settings, workspaceKind).find((item) => item.code === duty.dutyCode)
      dutyEntryId = crypto.randomUUID()
      await insertDutyEntry(db, {
        id: dutyEntryId,
        organizationId: orgId,
        projectId,
        entryDate: input.completedOn,
        userId: user.id,
        dutyCode: duty.dutyCode,
        dutyLabel: option?.label ?? duty.title,
        hours: hours.hours,
        notes: recurringDoneEntryNote({
          title: duty.title,
          accountName: duty.accountName,
          periodLabel: periodLabel(input.period),
          notes: input.notes,
        }),
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
    }
    try {
      await insertRecurringDutyCompletion(db, {
        id: crypto.randomUUID(),
        recurringDutyId: dutyId,
        period: input.period,
        completedOn: input.completedOn,
        completedBy: user.id,
        notes: input.notes.trim() || null,
        dutyEntryId,
        createdAt: now,
      })
    } catch (error) {
      if (dutyEntryId) await deleteDutyEntry(db, dutyEntryId)
      if (isUniqueConflict(error)) {
        return { success: false, error: `${periodLabel(input.period)} is already marked done.` }
      }
      throw error
    }
    revalidate(projectId)
    return { success: true, data: null }
  } catch (error) {
    return failure(error)
  }
}

/** Removes a period marked done by mistake, with the duty log entry it created. */
export async function undoRecurringDutyDone(projectId: string, completionId: string): Promise<Result<null>> {
  try {
    const { db, user } = await context(projectId)
    const [completion] = await db
      .select({
        id: recurringDutyCompletions.id,
        completedBy: recurringDutyCompletions.completedBy,
        dutyEntryId: recurringDutyCompletions.dutyEntryId,
        projectId: recurringDuties.projectId,
      })
      .from(recurringDutyCompletions)
      .innerJoin(recurringDuties, eq(recurringDuties.id, recurringDutyCompletions.recurringDutyId))
      .where(eq(recurringDutyCompletions.id, completionId))
      .limit(1)
    if (!completion || completion.projectId !== projectId) return { success: false, error: "That completion no longer exists." }
    if (completion.completedBy !== user.id && !canEditFeatureSettings(user.role, FEATURE)) {
      return { success: false, error: "Only the person who marked it, or an admin, can undo it." }
    }
    await deleteRecurringDutyCompletion(db, completionId)
    if (completion.dutyEntryId) await deleteDutyEntry(db, completion.dutyEntryId)
    revalidate(projectId)
    return { success: true, data: null }
  } catch (error) {
    return failure(error)
  }
}

const dutySchema = z.object({
  title: z.string().trim().min(1, "Enter a name.").max(80),
  accountName: z.string().trim().max(80),
  cadence: z.enum(["monthly", "quarterly", "yearly"]),
  dueDay: z.number().int().min(1, "Due day is 1–31.").max(31, "Due day is 1–31."),
  dutyCode: z.string().max(20),
  ownerUserId: z.string().max(80),
  active: z.boolean(),
})

export type RecurringDutyInput = z.infer<typeof dutySchema>

/** Admins add or change a recurring duty. */
export async function saveRecurringDuty(projectId: string, dutyId: string | null, raw: RecurringDutyInput): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, user, orgId } = await context(projectId)
    if (!canEditFeatureSettings(user.role, FEATURE)) return { success: false, error: "Only admins can change recurring duties." }
    const parsed = dutySchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the duty." }
    const input = parsed.data
    const now = new Date().toISOString()
    const values = {
      title: input.title,
      accountName: input.accountName || null,
      cadence: input.cadence,
      dueDay: input.dueDay,
      dutyCode: input.dutyCode || null,
      ownerUserId: input.ownerUserId || null,
      active: input.active,
      updatedAt: now,
    }
    if (dutyId) {
      if (!(await dutyFor(db, projectId, dutyId))) return { success: false, error: "That recurring duty no longer exists." }
      await updateRecurringDuty(db, dutyId, values)
      revalidate(projectId)
      return { success: true, data: { id: dutyId } }
    }
    const [last] = await db.select({ order: max(recurringDuties.sortOrder) }).from(recurringDuties).where(eq(recurringDuties.projectId, projectId))
    const id = crypto.randomUUID()
    await insertRecurringDuty(db, { id, organizationId: orgId, projectId, sortOrder: nextRecurringDutySortOrder(last?.order), createdAt: now, ...values })
    revalidate(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error)
  }
}

/** Deletes a duty that was never marked done; duties with history are turned off instead. */
export async function deleteRecurringDuty(projectId: string, dutyId: string): Promise<Result<{ readonly deactivated: boolean }>> {
  try {
    const { db, user } = await context(projectId)
    if (!canEditFeatureSettings(user.role, FEATURE)) return { success: false, error: "Only admins can change recurring duties." }
    if (!(await dutyFor(db, projectId, dutyId))) return { success: false, error: "That recurring duty no longer exists." }
    const [history] = await db
      .select({ id: recurringDutyCompletions.id })
      .from(recurringDutyCompletions)
      .where(eq(recurringDutyCompletions.recurringDutyId, dutyId))
      .limit(1)
    if (history) {
      await updateRecurringDuty(db, dutyId, { active: false, updatedAt: new Date().toISOString() })
      revalidate(projectId)
      return { success: true, data: { deactivated: true } }
    }
    await deleteRecurringDutyRow(db, dutyId)
    revalidate(projectId)
    return { success: true, data: { deactivated: false } }
  } catch (error) {
    return failure(error)
  }
}
