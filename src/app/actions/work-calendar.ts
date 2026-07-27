"use server"

import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { can, requirePermission } from "@/lib/permissions"
import {
  projectTodoHref,
  resolveHOfficeProjectId,
  scheduleItemHref,
} from "@/lib/work-calendar"

export type WorkCalendarEntryKind =
  | "schedule"
  | "event"
  | "rfi"
  | "purchase_order"
  | "task"

export type WorkCalendarEntry = {
  readonly id: string
  readonly kind: WorkCalendarEntryKind
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly companyName: string | null
  readonly sourceLabel: string
  readonly href: string
}

export type WorkCalendarData = {
  readonly today: string
  readonly entries: readonly WorkCalendarEntry[]
  readonly projects: readonly ProjectRow[]
  readonly defaultProjectId: string | null
  readonly canCreateEvents: boolean
}

export type ProjectRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
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
  if (recordType === "calendar_event") return "event"
  return "task"
}

function operationSourceLabel(recordType: string, recordNumber: string | null): string {
  if (recordType === "calendar_event") return "Calendar event"
  if (recordType === "schedule_task") {
    return recordNumber
      ? `Schedule item follow-up ${recordNumber}`
      : "Schedule item follow-up"
  }

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
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.organizationId, orgId))
    .orderBy(asc(projects.projectNumber), asc(projects.name))

  const entries: WorkCalendarEntry[] = []

  for (const project of projectRows) {
    const label = projectLabel(project)

    const taskRows = await db
      .select({
        id: scheduleTasks.id,
        title: scheduleTasks.title,
        status: scheduleTasks.status,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedTo: scheduleTasks.assignedTo,
        isCriticalPath: scheduleTasks.isCriticalPath,
      })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, project.id))
      .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

    for (const task of taskRows) {
      if (isClosedStatus(task.status)) continue
      if (task.endDate < rangeStart || task.startDate > rangeEnd) continue

      entries.push({
        id: task.id,
        kind: "schedule",
        projectId: project.id,
        projectLabel: label,
        projectName: project.name,
        title: task.title,
        status: task.status,
        priority: task.isCriticalPath ? "critical" : "normal",
        startDate: task.startDate,
        endDate: task.endDate,
        assignedTo: task.assignedTo,
        companyName: null,
        sourceLabel: "Project schedule",
        href: scheduleItemHref(project.id, task.id),
      })
    }

    const rfiRows = await db
      .select({
        id: projectRfis.id,
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        status: projectRfis.status,
        priority: projectRfis.priority,
        dueDate: projectRfis.dueDate,
        assignedToName: projectRfis.assignedToName,
        companyName: projectRfis.companyName,
      })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, project.id))
      .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

    for (const rfi of rfiRows) {
      if (isClosedStatus(rfi.status) || rfi.status === "complete") continue
      if (!rfi.dueDate || rfi.dueDate < rangeStart || rfi.dueDate > rangeEnd) {
        continue
      }

      entries.push({
        id: rfi.id,
        kind: "rfi",
        projectId: project.id,
        projectLabel: label,
        projectName: project.name,
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

    const operationRows = await db
      .select({
        id: projectOperations.id,
        sourceRecordType: projectOperations.sourceRecordType,
        sourceRecordNumber: projectOperations.sourceRecordNumber,
        title: projectOperations.title,
        status: projectOperations.status,
        priority: projectOperations.priority,
        assigneeName: projectOperations.assigneeName,
        companyName: projectOperations.companyName,
        startDate: projectOperations.startDate,
        dueDate: projectOperations.dueDate,
      })
      .from(projectOperations)
      .where(eq(projectOperations.projectId, project.id))
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

    for (const operation of operationRows) {
      if (isClosedStatus(operation.status)) continue
      const startDate = operation.startDate ?? operation.dueDate
      const endDate = operation.dueDate ?? operation.startDate
      if (!startDate || !endDate) continue
      if (endDate < rangeStart || startDate > rangeEnd) continue

      entries.push({
        id: operation.id,
        kind: operationKind(operation.sourceRecordType),
        projectId: project.id,
        projectLabel: label,
        projectName: project.name,
        title: operation.title,
        status: operation.status,
        priority: operation.priority,
        startDate,
        endDate,
        assignedTo: operation.assigneeName,
        companyName: operation.companyName,
        sourceLabel: operationSourceLabel(
          operation.sourceRecordType,
          operation.sourceRecordNumber
        ),
        href:
          operation.sourceRecordType === "purchase_order"
            ? `/dashboard/projects/${project.id}/purchase-orders`
            : operation.sourceRecordType === "calendar_event"
              ? `/dashboard/schedule?kind=event&item=${encodeURIComponent(operation.id)}#work-calendar-${encodeURIComponent(operation.id)}`
              : [
                    "staff_task",
                    "subcontractor_task",
                    "supplier_task",
                    "schedule_task",
                  ].includes(operation.sourceRecordType)
                ? projectTodoHref(project.id, operation.id)
                : `/dashboard/projects/${project.id}`,
      })
    }
  }

  entries.sort((left, right) => {
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate

    const byProject = left.projectLabel.localeCompare(right.projectLabel)
    if (byProject !== 0) return byProject

    return left.title.localeCompare(right.title)
  })

  return {
    today,
    entries,
    projects: projectRows,
    defaultProjectId: resolveHOfficeProjectId(projectRows),
    canCreateEvents: can(user, "schedule", "create"),
  }
}

export type CreateWorkCalendarEventInput = {
  readonly title: string
  readonly description: string | null
  readonly projectId: string | null
  readonly startDate: string
  readonly endDate: string
}

type CreateWorkCalendarEventResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

function cleanRequiredText(value: string, label: string): string {
  const cleaned = value.trim()
  if (cleaned.length === 0) throw new Error(`${label} is required`)
  return cleaned
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function createWorkCalendarEvent(
  input: CreateWorkCalendarEventInput
): Promise<CreateWorkCalendarEventResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "create")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const projectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(eq(projects.organizationId, orgId))

    const projectId =
      input.projectId?.trim() || resolveHOfficeProjectId(projectRows)
    if (!projectId) {
      return {
        success: false,
        error:
          "Select a project. Compass could not resolve one unique H-Office project for this organization.",
      }
    }

    const project = projectRows.find((candidate) => candidate.id === projectId)
    if (!project) {
      return { success: false, error: "Project not found" }
    }

    const title = cleanRequiredText(input.title, "Event title")
    const startDate = cleanRequiredText(input.startDate, "Start date")
    const endDate = cleanRequiredText(input.endDate, "End date")
    if (!isDateKey(startDate) || !isDateKey(endDate)) {
      return { success: false, error: "Enter valid event dates." }
    }
    if (endDate < startDate) {
      return {
        success: false,
        error: "End date must be on or after the start date.",
      }
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "calendar_event",
      title,
      description: input.description?.trim() || null,
      status: "open",
      priority: "normal",
      startDate,
      dueDate: endDate,
      syncDirection: "read",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/schedule")
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard")
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create calendar event",
    }
  }
}
