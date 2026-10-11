"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { dailyLogs, organizationMembers, projects, users } from "@/db/schema"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { dutiesFor, monthSummary, parseHours, type DutyOption, type DutySummaryRow, type WorkspaceKind } from "@/lib/internal-duties/model"
import { requireOrg } from "@/lib/org-scope"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectNumberAndName } from "@/lib/project-display-name"
import { isInternalStaffRole } from "@/lib/user-roles"
import { dutiesNeedingAttention, loadRecurringDuties, type RecurringDutyView } from "@/lib/internal-duties/recurring-data"

const FEATURE = "internal-duties"

type Db = ReturnType<typeof getDb>
type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type DutyLogEntryView = {
  readonly id: string
  readonly entryDate: string
  readonly userId: string | null
  readonly userName: string
  readonly dutyCode: string
  readonly dutyLabel: string
  readonly hours: number | null
  readonly notes: string | null
  readonly relatedProjectId: string | null
  readonly relatedProjectLabel: string | null
  readonly dailyLogId: string | null
}

export type UncategorizedLogView = {
  readonly id: string
  readonly logDate: string
  readonly authorName: string
  readonly text: string
  readonly hours: number | null
}

export type DutyLogWorkspace = {
  readonly project: { readonly id: string; readonly label: string; readonly workspaceKind: WorkspaceKind | null }
  readonly duties: readonly DutyOption[]
  readonly entries: readonly DutyLogEntryView[]
  readonly uncategorizedLogs: readonly UncategorizedLogView[]
  readonly summary: readonly DutySummaryRow[]
  readonly summaryMonth: string
  readonly relatedProjects: readonly { readonly value: string; readonly label: string }[]
  readonly currentUserId: string
  readonly canEdit: boolean
  /** Admins may edit anyone's entries and turn a project into an internal workspace. */
  readonly canManage: boolean
  readonly recurring: readonly RecurringDutyView[]
  /** Staff who can own a recurring duty. */
  readonly staff: readonly { readonly value: string; readonly label: string }[]
}

function nameOf(user: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null } | null): string {
  if (!user) return "Unknown"
  return user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown"
}

async function context(): Promise<{ readonly db: Db; readonly user: AuthUser; readonly orgId: string }> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), user, orgId }
}

async function loadProject(db: Db, orgId: string, projectId: string) {
  const [project] = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, workspaceKind: projects.workspaceKind })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)
  return project ?? null
}

export async function getDutyLogWorkspace(projectId: string, month?: string): Promise<DutyLogWorkspace | null> {
  const { db, user, orgId } = await context()
  await requireFeaturePermission(user, FEATURE, "read")
  const project = await loadProject(db, orgId, projectId)
  if (!project) return null
  const summaryMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7)
  const kind = project.workspaceKind
  const [settings, entryRows, logRows, related, canEdit, recurring, staffRows] = await Promise.all([
    readFeatureSettings(db, orgId, "internal-duties"),
    db
      .select({
        entry: internalDutyEntries,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(internalDutyEntries)
      .leftJoin(users, eq(users.id, internalDutyEntries.userId))
      .where(eq(internalDutyEntries.projectId, projectId))
      .orderBy(desc(internalDutyEntries.entryDate), desc(internalDutyEntries.createdAt))
      .limit(500),
    db
      .select({
        id: dailyLogs.id,
        logDate: dailyLogs.logDate,
        workCompleted: dailyLogs.workCompleted,
        notes: dailyLogs.notes,
        hours: dailyLogs.hoursWorked,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(dailyLogs)
      .leftJoin(users, eq(users.id, dailyLogs.authorId))
      .where(eq(dailyLogs.projectId, projectId))
      .orderBy(desc(dailyLogs.logDate))
      .limit(400),
    db
      .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
      .from(projects)
      .where(and(eq(projects.organizationId, orgId), inArray(projects.status, ["OPEN", "WARRANTY"])))
      .orderBy(asc(projects.projectNumber)),
    canFeature(user, FEATURE, "update"),
    kind ? loadRecurringDuties(db, projectId) : Promise.resolve([]),
    db
      .select({ id: users.id, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(users.isActive, true))),
  ])
  const relatedLabels = new Map(related.map((item) => [item.id, projectNumberAndName(item)]))
  const entries: DutyLogEntryView[] = entryRows.map(({ entry, ...person }) => ({
    id: entry.id,
    entryDate: entry.entryDate,
    userId: entry.userId,
    userName: nameOf(person),
    dutyCode: entry.dutyCode,
    dutyLabel: entry.dutyLabel,
    hours: entry.hours,
    notes: entry.notes,
    relatedProjectId: entry.relatedProjectId,
    relatedProjectLabel: entry.relatedProjectId ? (relatedLabels.get(entry.relatedProjectId) ?? null) : null,
    dailyLogId: entry.dailyLogId,
  }))
  const categorized = new Set(entries.flatMap((entry) => (entry.dailyLogId ? [entry.dailyLogId] : [])))
  return {
    project: { id: project.id, label: projectNumberAndName(project), workspaceKind: kind },
    duties: kind ? dutiesFor(settings, kind) : [],
    entries,
    uncategorizedLogs: logRows
      .filter((log) => !categorized.has(log.id))
      .map((log) => ({
        id: log.id,
        logDate: log.logDate,
        authorName: nameOf(log),
        text: [log.workCompleted, log.notes].map((part) => part?.trim() ?? "").filter(Boolean).join(" — "),
        hours: log.hours,
      })),
    summary: monthSummary(entries, summaryMonth),
    summaryMonth,
    relatedProjects: related.filter((item) => item.id !== projectId).map((item) => ({ value: item.id, label: projectNumberAndName(item) })),
    currentUserId: user.id,
    canEdit: canEdit && !isDemoUser(user.id) && kind !== null,
    canManage: canEditFeatureSettings(user.role, "internal-duties"),
    recurring,
    staff: staffRows
      .filter((row) => isInternalStaffRole(row.role))
      .map((row) => ({ value: row.id, label: nameOf(row) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}

const entrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  dutyCode: z.string().min(1, "Choose a duty.").max(20),
  hours: z.string().max(10),
  notes: z.string().max(4000),
  relatedProjectId: z.string().max(80).nullable(),
  /** Set when this entry categorizes an existing daily log. */
  dailyLogId: z.string().max(80).nullable(),
})

export type DutyEntryInput = z.infer<typeof entrySchema>

async function editContext(projectId: string) {
  const ctx = await context()
  if (isDemoUser(ctx.user.id)) throw new Error("The demo account can't change the duty log.")
  await requireFeaturePermission(ctx.user, FEATURE, "update")
  const project = await loadProject(ctx.db, ctx.orgId, projectId)
  if (!project) throw new Error("Project not found.")
  if (!project.workspaceKind) throw new Error("This project isn't an internal workspace.")
  return { ...ctx, project, workspaceKind: project.workspaceKind }
}

function failure(error: unknown): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : "Couldn't save the duty log." }
}

/** Creates an entry, or updates one the person owns (admins may update any). */
export async function saveDutyEntry(projectId: string, entryId: string | null, raw: DutyEntryInput): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, user, orgId, workspaceKind } = await editContext(projectId)
    const parsed = entrySchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the entry." }
    const input = parsed.data
    const hours = parseHours(input.hours)
    if (!hours.ok) return { success: false, error: hours.error }
    const settings = await readFeatureSettings(db, orgId, "internal-duties")
    const duty = dutiesFor(settings, workspaceKind).find((option) => option.code === input.dutyCode)
    if (!duty) return { success: false, error: "That duty isn't on the list for this workspace." }
    if (input.relatedProjectId) {
      const related = await loadProject(db, orgId, input.relatedProjectId)
      if (!related) return { success: false, error: "The related project wasn't found." }
    }
    const now = new Date().toISOString()
    const values = {
      entryDate: input.entryDate,
      dutyCode: duty.code,
      dutyLabel: duty.label,
      hours: hours.hours,
      notes: input.notes.trim() || null,
      relatedProjectId: input.relatedProjectId,
      updatedAt: now,
    }
    if (entryId) {
      const [existing] = await db
        .select({ userId: internalDutyEntries.userId })
        .from(internalDutyEntries)
        .where(and(eq(internalDutyEntries.id, entryId), eq(internalDutyEntries.projectId, projectId)))
        .limit(1)
      if (!existing) return { success: false, error: "That entry no longer exists." }
      if (existing.userId !== user.id && !canEditFeatureSettings(user.role, "internal-duties")) {
        return { success: false, error: "You can only change your own entries." }
      }
      await db.update(internalDutyEntries).set(values).where(eq(internalDutyEntries.id, entryId))
      revalidatePath(`/dashboard/projects/${projectId}/duty-log`)
      return { success: true, data: { id: entryId } }
    }
    let userId = user.id
    if (input.dailyLogId) {
      // Categorizing an old log keeps its author as the person who did the work.
      const [log] = await db
        .select({ authorId: dailyLogs.authorId })
        .from(dailyLogs)
        .where(and(eq(dailyLogs.id, input.dailyLogId), eq(dailyLogs.projectId, projectId)))
        .limit(1)
      if (!log) return { success: false, error: "That daily log no longer exists." }
      userId = log.authorId ?? user.id
    }
    const id = crypto.randomUUID()
    await db.insert(internalDutyEntries).values({
      id,
      organizationId: orgId,
      projectId,
      userId,
      dailyLogId: input.dailyLogId,
      createdBy: user.id,
      createdAt: now,
      ...values,
    })
    revalidatePath(`/dashboard/projects/${projectId}/duty-log`)
    return { success: true, data: { id } }
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return { success: false, error: "That daily log already has a duty." }
    return failure(error)
  }
}

/** Removes an entry. A categorized daily log goes back to waiting for a duty; the log itself is kept. */
export async function deleteDutyEntry(projectId: string, entryId: string): Promise<Result<null>> {
  try {
    const { db, user } = await editContext(projectId)
    const [existing] = await db
      .select({ userId: internalDutyEntries.userId })
      .from(internalDutyEntries)
      .where(and(eq(internalDutyEntries.id, entryId), eq(internalDutyEntries.projectId, projectId)))
      .limit(1)
    if (!existing) return { success: false, error: "That entry no longer exists." }
    if (existing.userId !== user.id && !canEditFeatureSettings(user.role, "internal-duties")) {
      return { success: false, error: "You can only delete your own entries." }
    }
    await db.delete(internalDutyEntries).where(eq(internalDutyEntries.id, entryId))
    revalidatePath(`/dashboard/projects/${projectId}/duty-log`)
    return { success: true, data: null }
  } catch (error) {
    return failure(error)
  }
}

/** Admins turn a project into an office or field workspace, or back into a regular project. */
export async function setProjectWorkspaceKind(projectId: string, kind: WorkspaceKind | null): Promise<Result<null>> {
  try {
    const { db, user, orgId } = await context()
    if (!canEditFeatureSettings(user.role, "internal-duties")) return { success: false, error: "Only admins can change this." }
    const project = await loadProject(db, orgId, projectId)
    if (!project) return { success: false, error: "Project not found." }
    if (kind === null) {
      const [used] = await db
        .select({ id: internalDutyEntries.id })
        .from(internalDutyEntries)
        .where(eq(internalDutyEntries.projectId, projectId))
        .limit(1)
      if (used) return { success: false, error: "This workspace has duty entries. Delete them first." }
    }
    await db.update(projects).set({ workspaceKind: kind }).where(eq(projects.id, projectId))
    revalidatePath(`/dashboard/projects/${projectId}/duty-log`)
    return { success: true, data: null }
  } catch (error) {
    return failure(error)
  }
}

export type InternalWorkspaceSummary = {
  readonly projectId: string
  readonly workspaceKind: WorkspaceKind
  /** Monday of the current week, YYYY-MM-DD. */
  readonly weekStart: string
  readonly weekHours: number
  readonly byDuty: readonly DutySummaryRow[]
  readonly byPerson: readonly { readonly name: string; readonly hours: number; readonly entries: number }[]
  /** Daily logs written before the duty log that still need a duty. */
  readonly waitingLogs: number
  readonly canEdit: boolean
  /** Recurring duties behind, due soon, or not started yet. */
  readonly attention: readonly RecurringDutyView[]
}

function mondayOf(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

/** The Overview panel for an internal workspace; null for client projects. */
export async function getInternalWorkspaceSummary(projectId: string): Promise<InternalWorkspaceSummary | null> {
  const { db, user, orgId } = await context()
  if (!(await canFeature(user, FEATURE, "read"))) return null
  const project = await loadProject(db, orgId, projectId)
  if (!project?.workspaceKind) return null
  const weekStart = mondayOf(new Date())
  const [entryRows, logRows, canEdit, recurring] = await Promise.all([
    db
      .select({
        entryDate: internalDutyEntries.entryDate,
        dutyCode: internalDutyEntries.dutyCode,
        dutyLabel: internalDutyEntries.dutyLabel,
        hours: internalDutyEntries.hours,
        dailyLogId: internalDutyEntries.dailyLogId,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(internalDutyEntries)
      .leftJoin(users, eq(users.id, internalDutyEntries.userId))
      .where(eq(internalDutyEntries.projectId, projectId)),
    db.select({ id: dailyLogs.id }).from(dailyLogs).where(eq(dailyLogs.projectId, projectId)),
    canFeature(user, FEATURE, "update"),
    loadRecurringDuties(db, projectId),
  ])
  const week = entryRows.filter((entry) => entry.entryDate >= weekStart)
  const people = new Map<string, { name: string; hours: number; entries: number }>()
  for (const entry of week) {
    const name = nameOf(entry)
    const row = people.get(name) ?? { name, hours: 0, entries: 0 }
    row.hours += entry.hours ?? 0
    row.entries += 1
    people.set(name, row)
  }
  const categorized = new Set(entryRows.flatMap((entry) => (entry.dailyLogId ? [entry.dailyLogId] : [])))
  return {
    projectId,
    workspaceKind: project.workspaceKind,
    weekStart,
    weekHours: week.reduce((sum, entry) => sum + (entry.hours ?? 0), 0),
    // monthSummary groups by duty; giving it the week's entries and "" matches them all.
    byDuty: monthSummary(week, ""),
    byPerson: [...people.values()].sort((a, b) => b.hours - a.hours),
    waitingLogs: logRows.filter((log) => !categorized.has(log.id)).length,
    canEdit: canEdit && !isDemoUser(user.id),
    attention: dutiesNeedingAttention(recurring),
  }
}
