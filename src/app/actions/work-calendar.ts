"use server"

import { asc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectOperations,
  projectMembers,
  projectRfis,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

export type WorkCalendarEntryKind =
  | "schedule"
  | "rfi"
  | "purchase_order"
  | "task"

export type WorkCalendarEntry = {
  readonly id: string
  readonly kind: WorkCalendarEntryKind
  readonly projectId: string
  readonly projectLabel: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly companyName: string | null
  readonly sourceLabel: string
  readonly href: string
  readonly isUndated?: boolean
}

export type WorkCalendarData = {
  readonly today: string
  readonly entries: readonly WorkCalendarEntry[]
  readonly taskEntries: readonly WorkCalendarEntry[]
  readonly masterScheduleEntries: readonly WorkCalendarEntry[]
  readonly projects: readonly WorkCalendarProject[]
}

export type WorkCalendarProject = {
  readonly id: string
  readonly label: string
  readonly status: string
}

type ProjectRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly status: string
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function projectLabel(project: ProjectRow): string {
  return project.projectNumber ?? project.name
}

function isClosedStatus(status: string): boolean {
  return [
    "closed",
    "complete",
    "completed",
    "inactive",
    "archive",
    "archived",
    "cancelled",
    "void",
  ].includes(status.trim().toLowerCase())
}

function operationKind(recordType: string): WorkCalendarEntryKind {
  if (recordType === "purchase_order") return "purchase_order"
  return "task"
}

function isTaskRecordType(recordType: string): boolean {
  return [
    "staff_task",
    "subcontractor_task",
    "supplier_task",
    "schedule_task",
  ].includes(recordType)
}

function operationSourceLabel(recordType: string, recordNumber: string | null): string {
  const label = recordType
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

  return recordNumber ? `${label} ${recordNumber}` : label
}

export async function getWorkCalendar(): Promise<WorkCalendarData> {
  const user = await requireAuth()
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const todayDate = new Date()
  const today = toDateKey(todayDate)
  const rangeStart = toDateKey(addDays(todayDate, -14))
  const rangeEnd = toDateKey(addDays(todayDate, 30))
  const projectSelection = {
    id: projects.id,
    name: projects.name,
    projectNumber: projects.projectNumber,
    status: projects.status,
  }
  const projectRows =
    user.organizationType === "internal" &&
    canUseOrganizationProjectScopeRole(user.role)
      ? await db
          .select(projectSelection)
          .from(projects)
          .where(eq(projects.organizationId, orgId))
          .orderBy(asc(projects.projectNumber), asc(projects.name))
      : await db
          .select(projectSelection)
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(eq(projectMembers.userId, user.id))
          .orderBy(asc(projects.projectNumber), asc(projects.name))

  const entries: WorkCalendarEntry[] = []
  const taskEntries: WorkCalendarEntry[] = []
  const masterScheduleEntries: WorkCalendarEntry[] = []
  const projectIds = projectRows.map((project) => project.id)
  const projectById = new Map(projectRows.map((project) => [project.id, project]))

  if (projectIds.length === 0) {
    return {
      today,
      entries,
      taskEntries,
      masterScheduleEntries,
      projects: [],
    }
  }

  const scheduleRows: (typeof scheduleTasks.$inferSelect)[] = []
  const rfiRows: (typeof projectRfis.$inferSelect)[] = []
  const operationRows: (typeof projectOperations.$inferSelect)[] = []
  const projectBatchSize = 80

  // D1 has a low parameter ceiling. Imported organizations can have hundreds
  // of projects, so calendar queries must never place every project ID in one IN.
  for (let index = 0; index < projectIds.length; index += projectBatchSize) {
    const batchProjectIds = projectIds.slice(index, index + projectBatchSize)
    const [scheduleBatch, rfiBatch, operationBatch] = await Promise.all([
      db
        .select()
        .from(scheduleTasks)
        .where(inArray(scheduleTasks.projectId, batchProjectIds)),
      db
        .select()
        .from(projectRfis)
        .where(inArray(projectRfis.projectId, batchProjectIds)),
      db
        .select()
        .from(projectOperations)
        .where(inArray(projectOperations.projectId, batchProjectIds)),
    ])
    scheduleRows.push(...scheduleBatch)
    rfiRows.push(...rfiBatch)
    operationRows.push(...operationBatch)
  }

  scheduleRows.sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.sortOrder - right.sortOrder,
  )
  rfiRows.sort(
    (left, right) =>
      (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
      left.rfiNumber.localeCompare(right.rfiNumber),
  )
  operationRows.sort(
    (left, right) =>
      (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
      left.title.localeCompare(right.title),
  )

  for (const task of scheduleRows) {
    const project = projectById.get(task.projectId)
    if (!project || isClosedStatus(task.status)) continue
    const label = projectLabel(project)
    const scheduleEntry: WorkCalendarEntry = {
      id: task.id,
      kind: "schedule",
      projectId: project.id,
      projectLabel: label,
      title: task.title,
      status: task.status,
      priority: task.isCriticalPath ? "critical" : "normal",
      startDate: task.startDate,
      endDate: task.endDateCalculated,
      assignedTo: task.assignedTo,
      companyName: null,
      sourceLabel: task.phase || "Project schedule",
      href: `/dashboard/projects/${project.id}/schedule`,
    }
    masterScheduleEntries.push(scheduleEntry)
    if (task.endDateCalculated < rangeStart || task.startDate > rangeEnd) continue
    entries.push(scheduleEntry)
  }

  for (const rfi of rfiRows) {
    const project = projectById.get(rfi.projectId)
    if (!project || isClosedStatus(rfi.status) || rfi.status === "complete") {
      continue
    }
    if (!rfi.dueDate || rfi.dueDate < rangeStart || rfi.dueDate > rangeEnd) {
      continue
    }
    entries.push({
      id: rfi.id,
      kind: "rfi",
      projectId: project.id,
      projectLabel: projectLabel(project),
      title: rfi.subject,
      status: rfi.status,
      priority: rfi.priority,
      startDate: rfi.dueDate,
      endDate: rfi.dueDate,
      assignedTo: rfi.assignedToName,
      companyName: rfi.companyName,
      sourceLabel: `RFI ${rfi.rfiNumber}`,
      href: `/dashboard/projects/${project.id}/rfis`,
    })
  }

  for (const operation of operationRows) {
    const project = projectById.get(operation.projectId)
    if (!project || isClosedStatus(operation.status)) continue
    const startDate = operation.startDate ?? operation.dueDate
    const endDate = operation.dueDate ?? operation.startDate
    const calendarStart = startDate ?? today
    const calendarEnd = endDate ?? calendarStart
    const entry: WorkCalendarEntry = {
      id: operation.id,
      kind: operationKind(operation.sourceRecordType),
      projectId: project.id,
      projectLabel: projectLabel(project),
      title: operation.title,
      status: operation.status,
      priority: operation.priority,
      startDate: calendarStart,
      endDate: calendarEnd,
      assignedTo: operation.assigneeName,
      companyName: operation.companyName,
      sourceLabel: operationSourceLabel(
        operation.sourceRecordType,
        operation.sourceRecordNumber
      ),
      href: operation.externalUrl ??
        (operation.sourceRecordType === "purchase_order"
          ? `/dashboard/projects/${project.id}/purchase-orders`
          : `/dashboard/projects/${project.id}`),
      isUndated: !startDate && !endDate,
    }

    if (isTaskRecordType(operation.sourceRecordType)) taskEntries.push(entry)
    if (calendarEnd < rangeStart || calendarStart > rangeEnd) continue
    entries.push(entry)
  }

  entries.sort((left, right) => {
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate

    const byProject = left.projectLabel.localeCompare(right.projectLabel)
    if (byProject !== 0) return byProject

    return left.title.localeCompare(right.title)
  })

  masterScheduleEntries.sort((left, right) => {
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate
    return left.projectLabel.localeCompare(right.projectLabel)
  })

  taskEntries.sort((left, right) => {
    if (left.isUndated !== right.isUndated) return left.isUndated ? 1 : -1
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate
    return left.projectLabel.localeCompare(right.projectLabel)
  })

  return {
    today,
    entries,
    taskEntries,
    masterScheduleEntries,
    projects: projectRows.map((project) => ({
      id: project.id,
      label: projectLabel(project),
      status: project.status,
    })),
  }
}
