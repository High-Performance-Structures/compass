import { and, asc, eq, inArray } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  dailyLogs,
  organizationCalendarSettings,
  organizationMembers,
  projectContacts,
  projectInteractions,
  projectOperations,
  projectProfileAuditEvents,
  projects,
  projectTodoEvents,
  users,
} from "@/db/schema"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import { clientInteractionRecordProblem } from "@/lib/client-interactions/record-rules"
import type { DailyLogWorkLine } from "@/lib/daily-logs/daily-log-form"
import {
  clientContactFollowUpTitle,
  DAILY_LOG_TODO_TYPES,
  EMPTY_DAILY_LOG_FOLLOW_UPS,
  validateDailyLogFollowUps,
  type DailyLogClientContactOption,
  type DailyLogFollowUpRules,
  type DailyLogFollowUps,
  type DailyLogOpenTodo,
  type DailyLogTodoType,
} from "@/lib/daily-logs/log-followups"
import type { AuthUser } from "@/lib/auth"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { clearOverdueFollowUpReminders } from "@/lib/notifications/clear-on-read"
import { notifyProjectAssignment } from "@/lib/notifications/events"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { isInternalStaffRole } from "@/lib/user-roles"
import { instantForLocalDateTime } from "@/lib/work-calendar"

type Db = ReturnType<typeof getDb>

const OPEN_STATUSES = ["open", "in_progress", "blocked"] as const

/** Someone a new to-do from a log can be assigned to. */
export type DailyLogAssigneeOption = {
  readonly name: string
  readonly kind: DailyLogTodoType
}

/** Everything the log form needs for to-dos and client contact. */
export type DailyLogFollowUpSetup = {
  readonly rules: DailyLogFollowUpRules
  readonly openTodos: readonly DailyLogOpenTodo[]
  readonly clientContacts: readonly DailyLogClientContactOption[]
  readonly assignees: readonly DailyLogAssigneeOption[]
}

export async function dailyLogFollowUpRules(db: Db, organizationId: string): Promise<DailyLogFollowUpRules> {
  const [settings, interactions] = await Promise.all([
    readFeatureSettings(db, organizationId, "daily-log-followups"),
    readFeatureSettings(db, organizationId, "client-interactions"),
  ])
  return {
    todoMode: settings.todoMode,
    todoTypes: settings.todoTypes,
    workedMovesToInProgress: settings.workedMovesToInProgress,
    carryBlocked: settings.carryBlocked,
    todoCostCodes: settings.todoCostCodes,
    tickAddsLine: settings.todoCostCodes && settings.tickAddsLine,
    crewPicksCostCode: settings.todoCostCodes && settings.crewPicksCostCode,
    clientContact: settings.clientContact,
    clientContactSuggest: settings.clientContact && settings.clientContactSuggest,
    minimumSummaryCharacters: interactions.minimumSummaryCharacters,
  }
}

/** The company's time zone from its calendar settings, or the calendar's default. */
export async function companyTimeZone(db: Db, organizationId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: organizationCalendarSettings.timeZone })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
  // Same fallback as the work calendar when a company hasn't saved settings.
  return row?.timeZone ?? "America/Denver"
}

function openStatus(value: string): DailyLogOpenTodo["status"] | null {
  return OPEN_STATUSES.find((status) => status === value) ?? null
}

/** The project's open to-dos (not schedule items), oldest due first. */
export async function loadOpenDailyLogTodos(db: Db, projectId: string): Promise<readonly DailyLogOpenTodo[]> {
  const rows = await db
    .select({
      id: projectOperations.id,
      title: projectOperations.title,
      status: projectOperations.status,
      recordType: projectOperations.sourceRecordType,
      assigneeName: projectOperations.assigneeName,
      companyName: projectOperations.companyName,
      costCode: projectOperations.costCode,
      updatedAt: projectOperations.updatedAt,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        inArray(projectOperations.sourceRecordType, [...PROJECT_TODO_RECORD_TYPES]),
        inArray(projectOperations.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.createdAt))
  return rows.flatMap((row) => {
    const status = openStatus(row.status)
    if (!status || row.recordType === "schedule_task") return []
    return [{
      id: row.id,
      title: row.title,
      status,
      recordType: row.recordType,
      assigneeName: row.assigneeName,
      companyName: row.companyName,
      costCode: row.costCode?.trim() || null,
      changedOn: row.updatedAt.slice(0, 10),
    }]
  })
}

/** Active client (owner) contacts on the project. */
export async function loadDailyLogClientContacts(db: Db, projectId: string): Promise<readonly DailyLogClientContactOption[]> {
  const rows = await db
    .select({ id: projectContacts.id, name: projectContacts.displayName, role: projectContacts.role })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
    .orderBy(asc(projectContacts.displayName))
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role?.trim() || null }))
}

/**
 * Who a to-do from a log can go to: the company's staff, and the project's
 * subcontractor and supplier contacts.
 */
export async function loadDailyLogAssignees(db: Db, organizationId: string, projectId: string): Promise<readonly DailyLogAssigneeOption[]> {
  const [staff, contacts] = await Promise.all([
    db
      .select({ role: organizationMembers.role, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true))),
    db
      .select({ contactType: projectContacts.contactType, name: projectContacts.displayName, companyName: projectContacts.companyName })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))),
  ])
  const options: DailyLogAssigneeOption[] = []
  const seen = new Set<string>()
  const add = (name: string, kind: DailyLogTodoType): void => {
    const clean = name.trim()
    const key = `${kind}:${clean.toLowerCase()}`
    if (!clean || seen.has(key)) return
    seen.add(key)
    options.push({ name: clean, kind })
  }
  for (const row of staff) {
    if (!isInternalStaffRole(row.role)) continue
    add(row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email, "staff_task")
  }
  for (const row of contacts) {
    if (row.contactType === "subcontractor") add(row.companyName?.trim() || row.name, "subcontractor_task")
    else if (row.contactType === "supplier") add(row.companyName?.trim() || row.name, "supplier_task")
  }
  return options.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function dailyLogFollowUpSetup(db: Db, organizationId: string, projectId: string): Promise<DailyLogFollowUpSetup> {
  const [rules, openTodos, clientContacts, assignees] = await Promise.all([
    dailyLogFollowUpRules(db, organizationId),
    loadOpenDailyLogTodos(db, projectId),
    loadDailyLogClientContacts(db, projectId),
    loadDailyLogAssignees(db, organizationId, projectId),
  ])
  return { rules, openTodos, clientContacts, assignees }
}

/** A follow-up plan the server checked and can apply once the log is saved. */
export type CheckedDailyLogFollowUps =
  | {
      readonly ok: true
      readonly followUps: DailyLogFollowUps
      readonly rules: DailyLogFollowUpRules
      /** Open to-dos on the project the log refers to, by id. */
      readonly todos: ReadonlyMap<string, DailyLogOpenTodo>
      readonly contacts: ReadonlyMap<string, DailyLogClientContactOption>
      readonly timeZone: string
    }
  | { readonly ok: false; readonly error: string }

/**
 * Checks a log's to-do and client contact parts against the company's rules
 * before anything is saved. To-dos that were finished in the meantime (on a
 * phone that synced late) are dropped rather than failing the log.
 */
export async function checkDailyLogFollowUps(
  db: Db,
  organizationId: string,
  projectId: string,
  logDate: string,
  followUps: DailyLogFollowUps,
  /**
   * A log queued on a phone can't be fixed by the crew once it's syncing, so
   * parts that no longer pass are dropped instead of failing the whole log.
   */
  lenient = false,
): Promise<CheckedDailyLogFollowUps> {
  const [rules, openTodos, contactOptions, timeZone, interactionSettings] = await Promise.all([
    dailyLogFollowUpRules(db, organizationId),
    loadOpenDailyLogTodos(db, projectId),
    loadDailyLogClientContacts(db, projectId),
    companyTimeZone(db, organizationId),
    readFeatureSettings(db, organizationId, "client-interactions"),
  ])
  const todos = new Map(openTodos.map((todo) => [todo.id, todo]))
  const contacts = new Map(contactOptions.map((contact) => [contact.id, contact]))
  const cleaned: DailyLogFollowUps = {
    todoUpdates: followUps.todoUpdates.filter((update) => todos.has(update.todoId)),
    newTodos: rules.todoMode === "off" ? [] : followUps.newTodos.map((todo) => ({ ...todo, costCode: rules.crewPicksCostCode ? todo.costCode : "" })),
    clientContacts: rules.clientContact ? followUps.clientContacts : [],
  }
  const contactProblem = (contact: DailyLogFollowUps["clientContacts"][number]): string | null => {
    if (!contacts.has(contact.contactId)) return "Choose an active client contact on this project."
    return clientInteractionRecordProblem({ summary: contact.summary, occurredAt: `${logDate}T12:00:00Z` }, interactionSettings)
  }
  if (lenient) {
    const kept: DailyLogFollowUps = {
      todoUpdates: cleaned.todoUpdates,
      newTodos: cleaned.newTodos.filter((todo) => validateDailyLogFollowUps({ ...EMPTY_DAILY_LOG_FOLLOW_UPS, newTodos: [todo] }, rules).length === 0),
      clientContacts: cleaned.clientContacts.filter(
        (contact) => validateDailyLogFollowUps({ ...EMPTY_DAILY_LOG_FOLLOW_UPS, clientContacts: [contact] }, rules).length === 0 && contactProblem(contact) === null,
      ),
    }
    return { ok: true, followUps: kept, rules, todos, contacts, timeZone }
  }
  const errors = validateDailyLogFollowUps(cleaned, rules)
  if (errors.length > 0) return { ok: false, error: errors.map((error) => error.message).join(" ") }
  for (const contact of cleaned.clientContacts) {
    const problem = contactProblem(contact)
    if (problem) return { ok: false, error: problem }
  }
  return { ok: true, followUps: cleaned, rules, todos, contacts, timeZone }
}

/** Work lines whose to-do link points at a to-do on this project; others lose the link. */
export function linkedWorkLines(lines: readonly DailyLogWorkLine[], todoIds: ReadonlySet<string>): readonly DailyLogWorkLine[] {
  return lines.map((line) => (line.todoId && !todoIds.has(line.todoId) ? { ...line, todoId: null } : line))
}

export async function recordTodoEvent(
  db: Db,
  event: {
    readonly organizationId: string
    readonly projectId: string
    readonly todoId: string
    readonly kind: "created" | "worked" | "still_blocked" | "unblocked" | "status"
    readonly dailyLogId: string | null
    readonly fromStatus: string | null
    readonly toStatus: string | null
    readonly note: string | null
    readonly actorId: string | null
    readonly createdAt?: string
  },
): Promise<void> {
  await db.insert(projectTodoEvents).values({
    id: crypto.randomUUID(),
    organizationId: event.organizationId,
    projectId: event.projectId,
    todoId: event.todoId,
    kind: event.kind,
    dailyLogId: event.dailyLogId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note?.trim().slice(0, 500) || null,
    actorId: event.actorId,
    createdAt: event.createdAt ?? new Date().toISOString(),
  })
}

function assigneeTypeFor(recordType: DailyLogTodoType): string {
  if (recordType === "subcontractor_task") return "subcontractor"
  if (recordType === "supplier_task") return "supplier"
  return "internal"
}

function personName(user: AuthUser): string | null {
  return user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ") || null
}

/**
 * Applies a saved log's to-do updates, new to-dos and client contacts. Ticking
 * a to-do records the work and may move it to In progress; it never finishes
 * it. Returns how many to-dos were created.
 */
export async function applyDailyLogFollowUps(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly dailyLogId: string
    readonly logDate: string
    readonly creator: AuthUser
    readonly workCompleted: string
    readonly lines: readonly DailyLogWorkLine[]
    readonly checked: Extract<CheckedDailyLogFollowUps, { readonly ok: true }>
  },
): Promise<{ readonly createdTodos: number }> {
  const { checked, organizationId, projectId, dailyLogId, creator } = input
  const userId = creator.id
  const { rules, followUps } = checked
  const now = new Date().toISOString()
  const hoursByTodo = new Map<string, number>()
  const noteByTodo = new Map<string, string>()
  for (const line of input.lines) {
    if (!line.todoId) continue
    hoursByTodo.set(line.todoId, (hoursByTodo.get(line.todoId) ?? 0) + line.hours)
    if (line.description && !noteByTodo.has(line.todoId)) noteByTodo.set(line.todoId, line.description)
  }

  for (const update of followUps.todoUpdates) {
    const todo = checked.todos.get(update.todoId)
    if (!todo) continue
    let status: string = todo.status
    if (update.blocked === "still" && status === "blocked") {
      await recordTodoEvent(db, { organizationId, projectId, todoId: todo.id, kind: "still_blocked", dailyLogId, fromStatus: status, toStatus: status, note: null, actorId: userId })
    } else if (update.blocked === "cleared" && status === "blocked") {
      await recordTodoEvent(db, { organizationId, projectId, todoId: todo.id, kind: "unblocked", dailyLogId, fromStatus: status, toStatus: "in_progress", note: null, actorId: userId })
      status = "in_progress"
    }
    if (update.worked) {
      const next = status === "open" && rules.workedMovesToInProgress ? "in_progress" : status
      const hours = hoursByTodo.get(todo.id)
      const note = noteByTodo.get(todo.id) ?? input.workCompleted.slice(0, 300)
      await recordTodoEvent(db, {
        organizationId,
        projectId,
        todoId: todo.id,
        kind: "worked",
        dailyLogId,
        fromStatus: status,
        toStatus: next,
        note: hours ? `${hours} h · ${note}` : note,
        actorId: userId,
      })
      status = next
    }
    if (status !== todo.status) {
      await db
        .update(projectOperations)
        .set({ status, updatedAt: now })
        .where(and(eq(projectOperations.id, todo.id), eq(projectOperations.projectId, projectId)))
    }
  }

  const authorName = personName(creator)
  const [project, existingTodos] = await Promise.all([
    db.select({ sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(and(eq(projectOperations.projectId, projectId), inArray(projectOperations.sourceRecordType, [...PROJECT_TODO_RECORD_TYPES]))),
  ])
  let todoCount = existingTodos.length
  const created: { readonly title: string; readonly recordType: DailyLogTodoType; readonly assigneeName: string; readonly costCode: string; readonly description: string }[] = followUps.newTodos.map((todo) => ({
    title: todo.title.trim(),
    recordType: todo.recordType,
    assigneeName: todo.assigneeName.trim(),
    costCode: todo.costCode.trim(),
    description: `From the ${input.logDate} daily log (${todo.source === "issues" ? "issues" : "next steps"}): ${todo.title.trim()}`,
  }))

  for (const contact of followUps.clientContacts) {
    const person = checked.contacts.get(contact.contactId)
    if (!person) continue
    // No time given: midday on the log's date, so it lands on the right day.
    const occurredAt = instantForLocalDateTime(input.logDate, contact.time || "12:00", checked.timeZone)
    const occurredIso = occurredAt.success ? occurredAt.instant : `${input.logDate}T12:00:00.000Z`
    const id = crypto.randomUUID()
    const summary = contact.summary.trim()
    await db.insert(projectInteractions).values({
      id,
      organizationId,
      projectId,
      projectContactId: person.id,
      interactionType: contact.interactionType,
      direction: contact.direction,
      source: "manual",
      qualifiesForClientTouch: true,
      summary,
      occurredAt: occurredIso,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
      dailyLogId,
    })
    await db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      actorUserId: userId,
      eventType: "client_interaction_created",
      entityType: "project_interaction",
      entityId: id,
      beforeJson: JSON.stringify(null),
      afterJson: JSON.stringify({ interactionType: contact.interactionType, direction: contact.direction, summary, occurredAt: occurredIso, dailyLogId }),
      createdAt: now,
    })
    if (contact.followUpTodo) {
      created.push({
        title: clientContactFollowUpTitle(person.name, summary),
        recordType: "staff_task",
        assigneeName: authorName ?? "",
        costCode: "",
        description: `From the ${input.logDate} daily log (client contact): ${summary}`,
      })
    }
  }
  if (followUps.clientContacts.length > 0) {
    try {
      // Logged contact ends an overdue stretch, so its reminder clears.
      await clearOverdueFollowUpReminders(db, [projectId])
    } catch (error) {
      console.error("Unable to clear overdue follow-up reminders", error)
    }
  }

  for (const todo of created) {
    const id = crypto.randomUUID()
    todoCount += 1
    const recordType = DAILY_LOG_TODO_TYPES.find((type) => type === todo.recordType) ?? "staff_task"
    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: recordType,
      // The log it came from, like "Create to-do" on a saved log.
      sourceRecordId: dailyLogId,
      sourceRecordNumber: `TASK-${String(todoCount).padStart(3, "0")}`,
      title: todo.title,
      description: todo.description,
      status: "open",
      priority: "normal",
      assigneeType: assigneeTypeFor(recordType),
      assigneeName: todo.assigneeName || null,
      companyName: null,
      costCode: rules.todoCostCodes ? todo.costCode || null : null,
      sageJobId: project[0]?.sageJobId ?? null,
      sageJobNumber: project[0]?.sageJobNumber ?? null,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify({ source: "compass_task", linkedRecordId: dailyLogId, taskType: recordType, title: todo.title }),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })
    await recordTodoEvent(db, { organizationId, projectId, todoId: id, kind: "created", dailyLogId, fromStatus: null, toStatus: "open", note: null, actorId: userId })
    if (todo.assigneeName) {
      try {
        await notifyProjectAssignment({ organizationId, projectId, itemId: id, title: todo.title, assignedToName: todo.assigneeName, createdBy: creator, kind: "task" })
      } catch (error) {
        console.error("Daily log to-do assignment notification failed:", error)
      }
    }
  }
  return { createdTodos: created.length }
}

/** History rows for a to-do, newest last, with who did each. */
export type ProjectTodoHistoryItem = {
  readonly id: string
  readonly kind: string
  readonly dailyLogId: string | null
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly actorName: string | null
  readonly createdAt: string
  /** The log's date when the event came from a daily log. */
  readonly logDate: string | null
}

export async function loadProjectTodoHistory(db: Db, projectId: string, todoId: string): Promise<readonly ProjectTodoHistoryItem[]> {
  const rows = await db
    .select({
      id: projectTodoEvents.id,
      kind: projectTodoEvents.kind,
      dailyLogId: projectTodoEvents.dailyLogId,
      fromStatus: projectTodoEvents.fromStatus,
      toStatus: projectTodoEvents.toStatus,
      note: projectTodoEvents.note,
      createdAt: projectTodoEvents.createdAt,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      logDate: dailyLogs.logDate,
    })
    .from(projectTodoEvents)
    .leftJoin(users, eq(users.id, projectTodoEvents.actorId))
    .leftJoin(dailyLogs, eq(dailyLogs.id, projectTodoEvents.dailyLogId))
    .where(and(eq(projectTodoEvents.projectId, projectId), eq(projectTodoEvents.todoId, todoId)))
    .orderBy(asc(projectTodoEvents.createdAt))
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    dailyLogId: row.dailyLogId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    actorName: row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
    createdAt: row.createdAt,
    logDate: row.logDate,
  }))
}

/** Hours logged against each to-do, from daily log cost code lines. */
export async function loadTodoHours(db: Db, projectId: string): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ todoId: internalDutyEntries.todoId, hours: internalDutyEntries.hours })
    .from(internalDutyEntries)
    .where(eq(internalDutyEntries.projectId, projectId))
  const hours = new Map<string, number>()
  for (const row of rows) {
    if (!row.todoId || row.hours === null) continue
    hours.set(row.todoId, (hours.get(row.todoId) ?? 0) + row.hours)
  }
  return hours
}

/** How many distinct daily logs worked on each to-do. */
export async function loadTodoWorkedLogCounts(db: Db, projectId: string): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ todoId: projectTodoEvents.todoId, dailyLogId: projectTodoEvents.dailyLogId })
    .from(projectTodoEvents)
    .where(and(eq(projectTodoEvents.projectId, projectId), eq(projectTodoEvents.kind, "worked")))
  const logs = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.dailyLogId) continue
    const set = logs.get(row.todoId) ?? new Set<string>()
    set.add(row.dailyLogId)
    logs.set(row.todoId, set)
  }
  return new Map([...logs].map(([todoId, set]) => [todoId, set.size]))
}
