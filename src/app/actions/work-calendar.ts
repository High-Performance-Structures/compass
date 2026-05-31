"use server"

import { asc, eq } from "drizzle-orm"

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
}

export type WorkCalendarData = {
  readonly today: string
  readonly entries: readonly WorkCalendarEntry[]
}

type ProjectRow = {
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
  return "task"
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
        title: task.title,
        status: task.status,
        priority: task.isCriticalPath ? "critical" : "normal",
        startDate: task.startDate,
        endDate: task.endDate,
        assignedTo: task.assignedTo,
        companyName: null,
        sourceLabel: "Project schedule",
        href: `/dashboard/projects/${project.id}/schedule`,
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

  return { today, entries }
}
