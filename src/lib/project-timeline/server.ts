import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  activityEvents,
  dailyLogPhotos,
  dailyLogs,
  projectContacts,
  projectInteractions,
  projectOperations,
  projectTodoEvents,
  users,
} from "@/db/schema"
import { equipmentLogEntries, equipmentMachines } from "@/db/schema-equipment"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import { companyTimeZone } from "@/lib/daily-logs/log-followups-server"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { projectTodoStatusLabel } from "@/lib/project-todos"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import {
  hoursText,
  shiftDateKey,
  timelineDays,
  type ProjectTimeline,
  type ProjectTimelineItem,
  type ProjectTimelineKind,
} from "./model"

type Db = ReturnType<typeof getDb>

const INTERACTION_LABELS: Readonly<Record<string, string>> = {
  call: "Call",
  email: "Email",
  sms: "Text",
  meeting: "Meeting",
  site_visit: "Site visit",
  client_send: "Document sent",
}

function personName(row: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null }): string | null {
  return row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || null
}

function snippet(text: string | null, length = 240): string | null {
  const clean = text?.trim()
  if (!clean) return null
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean
}

/**
 * A project's timeline for `days` days ending on `to` (company time). Only
 * the kinds the company shows are loaded.
 */
export async function loadProjectTimeline(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly to?: string; readonly days?: number },
): Promise<ProjectTimeline> {
  const [settings, timeZone] = await Promise.all([
    readFeatureSettings(db, input.organizationId, "project-timeline"),
    companyTimeZone(db, input.organizationId),
  ])
  const to = input.to ?? dateKeyInTimeZone(new Date(), timeZone)
  const from = shiftDateKey(to, -((input.days ?? settings.days) - 1))
  // Timestamps are filtered to the company's days after a slightly wider query.
  const fromIso = `${shiftDateKey(from, -1)}T00:00:00.000Z`
  const toIso = `${shiftDateKey(to, 2)}T00:00:00.000Z`
  const inRange = (iso: string): string | null => {
    const day = dateKeyInTimeZone(new Date(iso), timeZone)
    return day >= from && day <= to ? day : null
  }
  const shows = (kind: ProjectTimelineKind): boolean => settings.kinds.includes(kind)
  const base = `/dashboard/projects/${encodeURIComponent(input.projectId)}`
  const items: ProjectTimelineItem[] = []

  // Daily logs and their cost code hours (also used for the hours summary).
  const logs = await db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      isClientVisible: dailyLogs.isClientVisible,
      createdAt: dailyLogs.createdAt,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(users.id, dailyLogs.authorId))
    .where(and(eq(dailyLogs.projectId, input.projectId), gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, to)))
  const logIds = logs.map((log) => log.id)
  const lines = logIds.length === 0
    ? []
    : (
        await Promise.all(
          Array.from({ length: Math.ceil(logIds.length / 90) }, (_, index) =>
            db
              .select({
                dailyLogId: internalDutyEntries.dailyLogId,
                code: internalDutyEntries.dutyCode,
                label: internalDutyEntries.dutyLabel,
                hours: internalDutyEntries.hours,
                todoId: internalDutyEntries.todoId,
              })
              .from(internalDutyEntries)
              .where(inArray(internalDutyEntries.dailyLogId, logIds.slice(index * 90, index * 90 + 90))),
          ),
        )
      ).flat()
  const photoCounts = logIds.length === 0
    ? []
    : (
        await Promise.all(
          Array.from({ length: Math.ceil(logIds.length / 90) }, (_, index) =>
            db
              .select({ dailyLogId: dailyLogPhotos.dailyLogId, count: sql<number>`count(*)` })
              .from(dailyLogPhotos)
              .where(inArray(dailyLogPhotos.dailyLogId, logIds.slice(index * 90, index * 90 + 90)))
              .groupBy(dailyLogPhotos.dailyLogId),
          ),
        )
      ).flat()
  const photosByLog = new Map(photoCounts.map((row) => [row.dailyLogId, Number(row.count)]))
  const codeHours = new Map<string, { label: string; hours: number }>()
  let todoHours = 0
  let otherHours = 0
  const linesByLog = new Map<string, { label: string; hours: number }[]>()
  for (const line of lines) {
    if (!line.dailyLogId || line.hours === null) continue
    const entry = codeHours.get(line.code) ?? { label: line.label, hours: 0 }
    entry.hours += line.hours
    codeHours.set(line.code, entry)
    if (line.todoId) todoHours += line.hours
    else otherHours += line.hours
    const list = linesByLog.get(line.dailyLogId) ?? []
    const existing = list.find((item) => item.label === `${line.code} ${line.label}`)
    if (existing) existing.hours += line.hours
    else list.push({ label: `${line.code} ${line.label}`, hours: line.hours })
    linesByLog.set(line.dailyLogId, list)
  }
  if (shows("log")) {
    for (const log of logs) {
      const author = personName(log)
      const photos = photosByLog.get(log.id) ?? 0
      const meta = [
        ...(linesByLog.get(log.id) ?? []).map((line) => `${line.label} ${hoursText(line.hours)}`),
        ...(photos > 0 ? [`${photos} ${photos === 1 ? "photo" : "photos"}`] : []),
      ].join(" · ")
      items.push({
        id: `log-${log.id}`,
        kind: "log",
        date: log.logDate,
        at: log.createdAt,
        title: author ? `Daily log by ${author}` : "Daily log",
        body: snippet(log.workCompleted),
        meta: meta || null,
        href: `${base}/daily-logs#daily-log-${log.id}`,
        hrefLabel: "Open log",
        ownerVisible: log.isClientVisible,
        blocked: false,
      })
    }
  }
  const logDateById = new Map(logs.map((log) => [log.id, log.logDate]))

  const [events, contacts, office, machines, schedule] = await Promise.all([
    shows("todo")
      ? db
          .select({
            id: projectTodoEvents.id,
            todoId: projectTodoEvents.todoId,
            kind: projectTodoEvents.kind,
            dailyLogId: projectTodoEvents.dailyLogId,
            fromStatus: projectTodoEvents.fromStatus,
            toStatus: projectTodoEvents.toStatus,
            note: projectTodoEvents.note,
            createdAt: projectTodoEvents.createdAt,
            title: projectOperations.title,
            assigneeName: projectOperations.assigneeName,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(projectTodoEvents)
          .innerJoin(projectOperations, eq(projectOperations.id, projectTodoEvents.todoId))
          .leftJoin(users, eq(users.id, projectTodoEvents.actorId))
          .where(and(eq(projectTodoEvents.projectId, input.projectId), gte(projectTodoEvents.createdAt, fromIso), lte(projectTodoEvents.createdAt, toIso)))
      : Promise.resolve([]),
    shows("contact")
      ? db
          .select({
            id: projectInteractions.id,
            interactionType: projectInteractions.interactionType,
            direction: projectInteractions.direction,
            summary: projectInteractions.summary,
            occurredAt: projectInteractions.occurredAt,
            dailyLogId: projectInteractions.dailyLogId,
            contactName: projectContacts.displayName,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(projectInteractions)
          .leftJoin(projectContacts, eq(projectContacts.id, projectInteractions.projectContactId))
          .leftJoin(users, eq(users.id, projectInteractions.createdBy))
          .where(
            and(
              eq(projectInteractions.projectId, input.projectId),
              isNull(projectInteractions.deletedAt),
              gte(projectInteractions.occurredAt, fromIso),
              lte(projectInteractions.occurredAt, toIso),
            ),
          )
      : Promise.resolve([]),
    shows("duty")
      ? db
          .select({
            id: internalDutyEntries.id,
            entryDate: internalDutyEntries.entryDate,
            code: internalDutyEntries.dutyCode,
            label: internalDutyEntries.dutyLabel,
            hours: internalDutyEntries.hours,
            notes: internalDutyEntries.notes,
            createdAt: internalDutyEntries.createdAt,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(internalDutyEntries)
          .leftJoin(users, eq(users.id, internalDutyEntries.userId))
          .where(
            and(
              eq(internalDutyEntries.relatedProjectId, input.projectId),
              gte(internalDutyEntries.entryDate, from),
              lte(internalDutyEntries.entryDate, to),
            ),
          )
      : Promise.resolve([]),
    shows("machine")
      ? db
          .select({
            id: equipmentLogEntries.id,
            kind: equipmentLogEntries.kind,
            entryDate: equipmentLogEntries.entryDate,
            costCode: equipmentLogEntries.costCode,
            runningHours: equipmentLogEntries.runningHours,
            standbyHours: equipmentLogEntries.standbyHours,
            idleHours: equipmentLogEntries.idleHours,
            operatorName: equipmentLogEntries.operatorName,
            notes: equipmentLogEntries.notes,
            createdAt: equipmentLogEntries.createdAt,
            machineName: equipmentMachines.name,
          })
          .from(equipmentLogEntries)
          .innerJoin(equipmentMachines, eq(equipmentMachines.id, equipmentLogEntries.machineId))
          .where(
            and(
              eq(equipmentLogEntries.projectId, input.projectId),
              eq(equipmentLogEntries.kind, "hours"),
              gte(equipmentLogEntries.entryDate, from),
              lte(equipmentLogEntries.entryDate, to),
            ),
          )
      : Promise.resolve([]),
    shows("schedule")
      ? db
          .select({ id: activityEvents.id, summary: activityEvents.summary, actorName: activityEvents.actorName, createdAt: activityEvents.createdAt })
          .from(activityEvents)
          .where(
            and(
              eq(activityEvents.projectId, input.projectId),
              eq(activityEvents.category, "schedule"),
              gte(activityEvents.createdAt, fromIso),
              lte(activityEvents.createdAt, toIso),
            ),
          )
      : Promise.resolve([]),
  ])

  // To-dos created from the same log read as one row.
  const createdFromLog = new Map<string, typeof events>()
  for (const event of events) {
    const date = (event.dailyLogId ? logDateById.get(event.dailyLogId) : null) ?? inRange(event.createdAt)
    if (!date) continue
    if (event.kind === "created" && event.dailyLogId) {
      const list = createdFromLog.get(event.dailyLogId) ?? []
      list.push(event)
      createdFromLog.set(event.dailyLogId, list)
      continue
    }
    const actor = personName(event)
    const title =
      event.kind === "worked"
        ? `Worked on: ${event.title}`
        : event.kind === "still_blocked"
          ? `Still blocked: ${event.title}`
          : event.kind === "unblocked"
            ? `Cleared: ${event.title}`
            : event.kind === "created"
              ? `Opened: ${event.title}`
              : event.toStatus === "complete"
                ? `Finished: ${event.title}`
                : `${event.title}: ${projectTodoStatusLabel(event.fromStatus ?? "open")} → ${projectTodoStatusLabel(event.toStatus ?? "open")}`
    const statusChange = event.kind === "worked" && event.fromStatus !== event.toStatus && event.toStatus
      ? `${projectTodoStatusLabel(event.fromStatus ?? "open")} → ${projectTodoStatusLabel(event.toStatus)}`
      : null
    items.push({
      id: `todo-${event.id}`,
      kind: "todo",
      date,
      at: event.createdAt,
      title,
      body: event.kind === "worked" ? snippet(event.note, 160) : null,
      meta: [statusChange, event.toStatus === "complete" && actor ? `Marked finished by ${actor}` : actor].filter(Boolean).join(" · ") || null,
      href: `${base}/todos?item=${encodeURIComponent(event.todoId)}`,
      hrefLabel: "Open to-do",
      ownerVisible: false,
      blocked: event.kind === "still_blocked",
    })
  }
  for (const [dailyLogId, created] of createdFromLog) {
    const first = created[0]
    const date = logDateById.get(dailyLogId) ?? (first ? inRange(first.createdAt) : null)
    if (!first || !date) continue
    items.push({
      id: `todo-created-${dailyLogId}`,
      kind: "todo",
      date,
      at: first.createdAt,
      title: created.length === 1 ? `To-do opened from this log: ${first.title}` : `${created.length} to-dos opened from this log`,
      body: created.length === 1 ? null : created.map((event) => (event.assigneeName ? `${event.title} (${event.assigneeName})` : event.title)).join(" · "),
      meta: first.assigneeName && created.length === 1 ? first.assigneeName : null,
      href: `${base}/todos`,
      hrefLabel: "View to-dos",
      ownerVisible: false,
      blocked: false,
    })
  }

  for (const contact of contacts) {
    const date = inRange(contact.occurredAt)
    if (!date) continue
    const staff = personName(contact)
    const type = INTERACTION_LABELS[contact.interactionType] ?? contact.interactionType.replace(/^custom:/, "")
    const who = contact.contactName ?? "Client"
    items.push({
      id: `contact-${contact.id}`,
      kind: "contact",
      date,
      at: contact.occurredAt,
      title: `${type} · ${contact.direction === "inbound" ? `${who} → ${staff ?? "us"}` : `${staff ?? "We"} → ${who}`}`,
      body: snippet(contact.summary),
      meta: contact.dailyLogId ? "Logged on a daily log" : null,
      href: contact.dailyLogId ? `${base}/daily-logs#daily-log-${contact.dailyLogId}` : `${base}/information`,
      hrefLabel: contact.dailyLogId ? "Open log" : "Follow-up",
      ownerVisible: false,
      blocked: false,
    })
  }

  for (const entry of office) {
    const person = personName(entry)
    items.push({
      id: `duty-${entry.id}`,
      kind: "duty",
      date: entry.entryDate,
      at: entry.createdAt,
      title: [person, `${entry.code} ${entry.label}`, entry.hours !== null ? hoursText(entry.hours) : null].filter(Boolean).join(" · "),
      body: snippet(entry.notes, 160),
      meta: "Duty log, tagged to this job",
      href: null,
      hrefLabel: null,
      ownerVisible: false,
      blocked: false,
    })
  }

  for (const entry of machines) {
    const parts = [
      entry.runningHours ? `${hoursText(entry.runningHours)} operated` : null,
      entry.standbyHours ? `${hoursText(entry.standbyHours)} standby` : null,
      entry.idleHours ? `${hoursText(entry.idleHours)} idle` : null,
    ].filter(Boolean)
    items.push({
      id: `machine-${entry.id}`,
      kind: "machine",
      date: entry.entryDate,
      at: entry.createdAt,
      title: [entry.machineName, ...parts].join(" · "),
      body: snippet(entry.notes, 160),
      meta: [entry.costCode, entry.operatorName].filter(Boolean).join(" · ") || null,
      href: null,
      hrefLabel: null,
      ownerVisible: false,
      blocked: false,
    })
  }

  for (const event of schedule) {
    const date = inRange(event.createdAt)
    if (!date) continue
    items.push({
      id: `schedule-${event.id}`,
      kind: "schedule",
      date,
      at: event.createdAt,
      title: event.summary,
      body: null,
      meta: event.actorName ? `By ${event.actorName}` : null,
      href: `${base}/schedule`,
      hrefLabel: "Schedule",
      ownerVisible: false,
      blocked: false,
    })
  }

  return {
    from,
    to,
    kinds: settings.kinds,
    days: timelineDays(items),
    codeHours: [...codeHours.entries()]
      .map(([code, entry]) => ({ code, label: entry.label, hours: entry.hours }))
      .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code, undefined, { numeric: true })),
    todoHours,
    otherHours,
  }
}
