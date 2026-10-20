#!/usr/bin/env bun
/**
 * Writes the SQL that (re)creates Summit Ridge Builders on the demo copy of
 * Compass. Run it, then apply the file to the demo database:
 *
 *   bun scripts/demo/build-summit-ridge-seed.ts --admin you@company.com > /tmp/summit-ridge.sql
 *   bunx wrangler d1 execute compass-demo-db --env demo --remote --file /tmp/summit-ridge.sql
 *
 * Re-running resets the sample company: its jobs, contacts, chat and sample
 * staff are deleted and recreated, and anything visitors added to Summit
 * Ridge goes with them. People who signed in keep their accounts and
 * membership. Each `--admin` email becomes a Summit Ridge admin the first
 * time that person signs in.
 *
 * The script only prints SQL. Apply it to compass-demo-db, never to the
 * production compass-db.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import {
  customers,
  dailyLogs,
  internalContacts,
  organizationCalendarSettings,
  organizationFeatureSettings,
  organizationMembers,
  projectContacts,
  projectInteractions,
  projectMembers,
  projectNotes,
  projectOperations,
  projects,
  projectTodoEvents,
  scheduleTasks,
  taskDependencies,
  users,
  vendors,
} from "../../src/db/schema"
import { channelMembers, channels, messages } from "../../src/db/schema-conversations"
import { DEPARTMENT_CODES } from "../../src/lib/department-profiles"
import { departmentProfilesSchema } from "../../src/lib/feature-settings/registry"
import {
  CHANNEL_MESSAGES,
  COMPANY,
  DEPARTMENTS,
  type DepartmentCode,
  INTERNAL_WORKSPACES,
  PROJECTS,
  type ProjectSeed,
  STAFF,
  VENDORS,
} from "./summit-ridge-data"

type Param = string | number | boolean | null | undefined

const db = drizzle(async () => ({ rows: [] }))
const statements: string[] = []

function literal(value: Param): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "boolean") return value ? "1" : "0"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"
  return `'${value.replaceAll("'", "''")}'`
}

/** Inline drizzle's parameters so the file runs with `wrangler d1 execute --file`. */
function emit(query: { toSQL: () => { sql: string; params: readonly unknown[] } }): void {
  const { sql, params } = query.toSQL()
  let index = 0
  const inlined = sql.replace(/\?/g, () => {
    const value = params[index++]
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return literal(value)
    }
    throw new Error(`Unsupported parameter: ${JSON.stringify(value)}`)
  })
  statements.push(`${inlined};`)
}

const insert = emit

// Work days relative to today (Mon-Fri), so the sample jobs always look current.
function workday(offset: number, from: Date = new Date()): string {
  const date = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 12))
  const step = offset < 0 ? -1 : 1
  let remaining = Math.abs(offset)
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + step)
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining--
  }
  return date.toISOString().slice(0, 10)
}

function endAfter(start: string, workdays: number): string {
  return workday(Math.max(0, workdays - 1), new Date(`${start}T12:00:00Z`))
}

function at(date: string, time: string): string {
  return `${date}T${time}:00.000Z`
}

const ORG = COMPANY.id
const now = new Date().toISOString()
const userId = (key: string): string => `sr-user-${key}`
const staffByKey = new Map(STAFF.map((person) => [person.key, person]))
const vendorByKey = new Map(VENDORS.map((vendor) => [vendor.key, vendor]))

function staffName(key: string): string {
  const person = staffByKey.get(key)
  if (!person) throw new Error(`Unknown staff member: ${key}`)
  return `${person.firstName} ${person.lastName}`
}

function email(first: string, last: string): string {
  return `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + `@${COMPANY.emailDomain}`
}

function adminEmails(argv: readonly string[]): readonly string[] {
  const emails: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--admin") {
      const value = argv[i + 1]?.trim().toLowerCase()
      if (!value || !value.includes("@")) throw new Error("--admin needs an email address")
      emails.push(value)
      i++
    }
  }
  return emails
}

function resetStatements(): void {
  // Children of projects cascade; these tables reference the org directly.
  statements.push(
    "PRAGMA defer_foreign_keys = on;",
    `DELETE FROM channels WHERE organization_id = '${ORG}';`,
    `DELETE FROM projects WHERE organization_id = '${ORG}';`,
    `DELETE FROM customers WHERE organization_id = '${ORG}';`,
    `DELETE FROM vendors WHERE organization_id = '${ORG}';`,
    `DELETE FROM internal_contacts WHERE organization_id = '${ORG}';`,
    `DELETE FROM organization_feature_settings WHERE organization_id = '${ORG}';`,
    `DELETE FROM organization_calendar_settings WHERE organization_id = '${ORG}';`,
    `DELETE FROM organization_members WHERE organization_id = '${ORG}' AND user_id LIKE 'sr-user-%';`,
    `DELETE FROM users WHERE id LIKE 'sr-user-%';`,
    `INSERT OR IGNORE INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES (${literal(ORG)}, ${literal(COMPANY.name)}, ${literal(COMPANY.slug)}, 'internal', 1, ${literal(now)}, ${literal(now)});`,
  )
}

function seedPeople(admins: readonly string[]): void {
  for (const person of STAFF) {
    insert(db.insert(users).values({
      id: userId(person.key),
      email: email(person.firstName, person.lastName),
      firstName: person.firstName,
      lastName: person.lastName,
      displayName: `${person.firstName} ${person.lastName}`,
      role: person.role,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }))
    insert(db.insert(organizationMembers).values({
      id: `sr-member-${person.key}`,
      organizationId: ORG,
      userId: userId(person.key),
      role: person.role,
      joinedAt: now,
    }))
    insert(db.insert(internalContacts).values({
      id: `sr-internal-${person.key}`,
      organizationId: ORG,
      userId: userId(person.key),
      name: staffName(person.key),
      jobTitle: person.jobTitle,
      email: email(person.firstName, person.lastName),
      phone: "719-555-0140",
      sourceSystem: "compass_user",
      sourceRecordId: userId(person.key),
      active: true,
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now,
    }))
  }
  // A placeholder account: the first WorkOS sign-in with this email claims it
  // (see the pending-placeholder match in lib/auth.ts) and keeps the admin seat.
  admins.forEach((address, index) => {
    const id = `sr-pending-admin-${index + 1}`
    statements.push(
      `INSERT OR IGNORE INTO users (id, email, role, is_active, created_at, updated_at) VALUES (${literal(id)}, ${literal(address)}, 'admin', 0, ${literal(now)}, ${literal(now)});`,
      `INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) SELECT ${literal(`sr-admin-member-${index + 1}`)}, ${literal(ORG)}, u.id, 'admin', ${literal(now)} FROM users u WHERE lower(u.email) = ${literal(address)} AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = ${literal(ORG)} AND m.user_id = u.id);`,
    )
  })
}

function logoDataUrl(code: DepartmentCode): string {
  const png = readFileSync(join(import.meta.dir, "logos", `${code}.png`))
  return `data:image/png;base64,${png.toString("base64")}`
}

function seedCompanySettings(): void {
  const departments = Object.fromEntries(
    DEPARTMENT_CODES.map((code) => {
      const profile = DEPARTMENTS[code]
      return [code, {
        ...profile,
        companyName: profile.displayName,
        mailingAddress: `PO Box 1200\n${COMPANY.town}`,
        website: "",
        licenseNumber: "",
        officeHours: "Mon-Fri 7:30 AM - 4:30 PM",
        senderAddress: "",
        senderName: "",
        logoDataUrl: logoDataUrl(code),
      }]
    }),
  )
  const parsed = departmentProfilesSchema.safeParse({ departments })
  if (!parsed.success) throw new Error(`Department profiles are invalid: ${parsed.error.message}`)
  insert(db.insert(organizationFeatureSettings).values({
    organizationId: ORG,
    featureKey: "department-profiles",
    value: JSON.stringify(parsed.data),
    updatedAt: now,
    updatedBy: userId("dana"),
  }))
  insert(db.insert(organizationCalendarSettings).values({
    organizationId: ORG,
    timeZone: "America/Denver",
    createdAt: now,
    updatedAt: now,
  }))
}

function seedVendors(): void {
  for (const vendor of VENDORS) {
    const [first, ...rest] = vendor.contact.split(" ")
    insert(db.insert(vendors).values({
      id: `sr-vendor-${vendor.key}`,
      organizationId: ORG,
      name: vendor.name,
      category: vendor.category,
      ownerName: vendor.contact,
      email: email(first ?? "office", rest.join("") || vendor.key).replace(COMPANY.emailDomain, `${vendor.key}.example`),
      phone: vendor.phone,
      city: "Cedar Bluff",
      state: "CO",
      sourceSystem: "manual",
      directoryStatus: "active",
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now,
    }))
  }
}

function seedProject(project: ProjectSeed): void {
  const projectId = `sr-proj-${project.key}`
  const customerId = `sr-cust-${project.key}`
  const ownerContactId = `sr-pc-${project.key}-owner`
  const created = at(workday(-45), "15:00")

  insert(db.insert(customers).values({
    id: customerId,
    organizationId: ORG,
    name: project.client.name,
    company: project.client.company ?? null,
    email: `office@${project.key}.example`,
    phone: project.client.phone,
    address: `${project.street}, ${project.city}`,
    relationshipType: "client",
    createdAt: created,
    updatedAt: created,
  }))
  insert(db.insert(projects).values({
    id: projectId,
    organizationId: ORG,
    projectNumber: project.number,
    department: project.department,
    name: project.name,
    status: "OPEN",
    address: `${project.street}, ${project.city}`,
    clientName: project.client.name,
    clientStatus: "customer",
    jobStatusId: project.jobStatusId,
    projectManager: staffName(project.manager),
    ownerUpdatesEnabled: true,
    ownerUpdateChannel: "compass",
    ownerUpdateCadence: "weekly",
    publicLocationCity: "Cedar Bluff, CO",
    createdAt: created,
    updatedAt: now,
  }))
  insert(db.insert(projectContacts).values({
    id: ownerContactId,
    projectId,
    contactType: "owner",
    sourceSystem: "customer_directory",
    sourceRecordId: customerId,
    sourceEntityType: "customer",
    sourceEntityId: customerId,
    customerId,
    displayName: project.client.name,
    companyName: project.client.company ?? null,
    role: "Owner / Client",
    email: `office@${project.key}.example`,
    phone: project.client.phone,
    address: `${project.street}, ${project.city}`,
    ownerPortalVisible: true,
    primaryContact: true,
    sortOrder: 100,
    syncStatus: "manual",
    createdAt: created,
    updatedAt: created,
  }))
  const team = [project.manager, ...project.crew.filter((key) => key !== project.manager)]
  team.forEach((key, index) => {
    insert(db.insert(projectContacts).values({
      id: `sr-pc-${project.key}-${key}`,
      projectId,
      contactType: "internal",
      sourceSystem: "internal_directory",
      sourceRecordId: `sr-internal-${key}`,
      sourceEntityType: "internal_contact",
      sourceEntityId: `sr-internal-${key}`,
      internalContactId: `sr-internal-${key}`,
      displayName: staffName(key),
      role: index === 0 ? "Project manager" : staffByKey.get(key)?.jobTitle ?? "Crew",
      email: email(staffByKey.get(key)?.firstName ?? key, staffByKey.get(key)?.lastName ?? ""),
      ownerPortalVisible: index === 0,
      subVendorPortalVisible: true,
      primaryContact: index === 0,
      sortOrder: 200 + index,
      syncStatus: "synced",
      createdAt: created,
      updatedAt: created,
    }))
    insert(db.insert(projectMembers).values({
      id: `sr-pm-${project.key}-${key}`,
      projectId,
      userId: userId(key),
      role: index === 0 ? "manager" : "member",
      assignedAt: created,
    }))
  })
  project.vendors.forEach((key, index) => {
    const vendor = vendorByKey.get(key)
    if (!vendor) throw new Error(`Unknown vendor: ${key}`)
    insert(db.insert(projectContacts).values({
      id: `sr-pc-${project.key}-v-${key}`,
      projectId,
      contactType: vendor.category === "Supplier" ? "supplier" : "subcontractor",
      sourceSystem: "vendor_directory",
      sourceRecordId: `sr-vendor-${key}`,
      sourceEntityType: "vendor",
      sourceEntityId: `sr-vendor-${key}`,
      vendorId: `sr-vendor-${key}`,
      displayName: vendor.contact,
      companyName: vendor.name,
      role: vendor.trade,
      trade: vendor.trade,
      phone: vendor.phone,
      subVendorPortalVisible: true,
      sortOrder: 300 + index,
      syncStatus: "manual",
      createdAt: created,
      updatedAt: created,
    }))
  })
  if (project.note) {
    insert(db.insert(projectNotes).values({
      id: `sr-note-${project.key}`,
      organizationId: ORG,
      projectId,
      content: project.note,
      createdBy: userId(project.manager),
      createdAt: created,
      updatedAt: created,
    }))
  }

  let previousCritical: string | null = null
  project.schedule.forEach((task, index) => {
    const id = `sr-task-${project.key}-${index + 1}`
    const start = workday(task.start)
    const vendor = task.vendor ? vendorByKey.get(task.vendor) : undefined
    insert(db.insert(scheduleTasks).values({
      id,
      projectId,
      title: task.title,
      startDate: start,
      workdays: task.workdays,
      endDateCalculated: endAfter(start, task.workdays),
      phase: task.phase,
      displayColor: task.milestone ? "green" : vendor ? "orange" : "blue",
      status: task.status,
      isCriticalPath: task.critical ?? false,
      isMilestone: task.milestone ?? false,
      percentComplete: task.status === "COMPLETE" ? 100 : task.percent ?? 0,
      assignedTo: vendor?.name ?? (task.assignee ? staffName(task.assignee) : null),
      assignedUserId: task.assignee ? userId(task.assignee) : null,
      ownerVisible: true,
      subVendorVisible: Boolean(vendor),
      sortOrder: index + 1,
      createdAt: created,
      updatedAt: now,
    }))
    if (task.critical) {
      if (previousCritical) {
        insert(db.insert(taskDependencies).values({
          id: `sr-dep-${project.key}-${index + 1}`,
          predecessorId: previousCritical,
          successorId: id,
          type: "FS",
          lagDays: 0,
        }))
      }
      previousCritical = id
    }
  })

  const logIds = project.logs.map((_, index) => `sr-log-${project.key}-${index + 1}`)
  project.logs.forEach((log, index) => {
    const logDate = workday(-log.daysAgo)
    insert(db.insert(dailyLogs).values({
      id: logIds[index] ?? "",
      projectId,
      authorId: userId(log.author),
      sourceSystem: "compass",
      logDate,
      weatherTempF: log.tempF,
      weatherConditions: log.weather,
      weatherSource: "manual",
      workCompleted: log.completed,
      issues: log.issues ?? null,
      crewPresent: log.crew,
      hoursWorked: log.hours,
      visitorLog: log.visitors ?? null,
      notes: log.notes ?? null,
      isClientVisible: false,
      reviewStatus: "needs_review",
      syncStatus: "synced",
      createdAt: at(logDate, "23:00"),
      updatedAt: at(logDate, "23:00"),
    }))
  })

  project.todos.forEach((todo, index) => {
    const id = `sr-todo-${project.key}-${index + 1}`
    const vendor = todo.type === "staff_task" ? undefined : vendorByKey.get(todo.assignee)
    const assigneeName = vendor ? vendor.contact : staffName(todo.assignee)
    const sourceLogId = todo.fromLog === undefined ? null : logIds[todo.fromLog] ?? null
    const sourceLog = todo.fromLog === undefined ? undefined : project.logs[todo.fromLog]
    const createdAt = sourceLog ? at(workday(-sourceLog.daysAgo), "23:05") : at(workday(-6), "16:00")
    insert(db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: todo.type,
      sourceRecordId: sourceLogId,
      sourceRecordNumber: `TASK-${String(index + 1).padStart(3, "0")}`,
      title: todo.title,
      description: sourceLog
        ? `From the ${workday(-sourceLog.daysAgo)} daily log`
        : todo.note ?? null,
      status: todo.status,
      priority: todo.priority ?? "normal",
      assigneeType: todo.type === "subcontractor_task" ? "subcontractor" : todo.type === "supplier_task" ? "supplier" : "internal",
      assigneeName,
      companyName: vendor?.name ?? null,
      dueDate: workday(todo.due),
      sageWriteStatus: "not_ready",
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt,
      updatedAt: now,
    }))
    insert(db.insert(projectTodoEvents).values({
      id: `sr-todo-event-${project.key}-${index + 1}-created`,
      organizationId: ORG,
      projectId,
      todoId: id,
      kind: "created",
      dailyLogId: sourceLogId,
      toStatus: "open",
      actorId: userId(sourceLog?.author ?? project.manager),
      createdAt,
    }))
    if (todo.status !== "open") {
      insert(db.insert(projectTodoEvents).values({
        id: `sr-todo-event-${project.key}-${index + 1}-status`,
        organizationId: ORG,
        projectId,
        todoId: id,
        kind: "status",
        fromStatus: "open",
        toStatus: todo.status,
        note: todo.note ?? null,
        actorId: userId(project.manager),
        createdAt: at(workday(-1), "18:00"),
      }))
    }
  })

  project.interactions.forEach((interaction, index) => {
    const occurredAt = at(workday(-interaction.daysAgo), "17:30")
    insert(db.insert(projectInteractions).values({
      id: `sr-int-${project.key}-${index + 1}`,
      organizationId: ORG,
      projectId,
      projectContactId: ownerContactId,
      interactionType: interaction.type,
      direction: interaction.direction,
      source: "manual",
      qualifiesForClientTouch: true,
      summary: interaction.summary,
      occurredAt,
      createdBy: userId(interaction.by),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }))
  })
}

function seedInternalWorkspaces(): void {
  for (const workspace of INTERNAL_WORKSPACES) {
    insert(db.insert(projects).values({
      id: `sr-proj-${workspace.key}`,
      organizationId: ORG,
      projectNumber: workspace.number,
      department: workspace.department,
      name: workspace.name,
      status: "OPEN",
      clientStatus: "customer",
      jobStatusId: "internal",
      workspaceKind: workspace.kind,
      internalDepartment: true,
      ownerUpdatesEnabled: false,
      createdAt: now,
      updatedAt: now,
    }))
  }
}

function seedChat(): void {
  const channelId = "sr-channel-general"
  insert(db.insert(channels).values({
    id: channelId,
    name: "general",
    type: "text",
    description: "Company-wide chat",
    organizationId: ORG,
    createdBy: userId("dana"),
    createdAt: now,
    updatedAt: now,
  }))
  for (const person of STAFF) {
    insert(db.insert(channelMembers).values({
      id: `sr-chm-${person.key}`,
      channelId,
      userId: userId(person.key),
      role: person.key === "dana" ? "owner" : "member",
      joinedAt: now,
    }))
  }
  CHANNEL_MESSAGES.forEach((message, index) => {
    insert(db.insert(messages).values({
      id: `sr-msg-${index + 1}`,
      channelId,
      userId: userId(message.by),
      content: message.text,
      createdAt: at(workday(-message.daysAgo), "16:00"),
    }))
  })
}

function main(): void {
  const admins = adminEmails(process.argv.slice(2))
  resetStatements()
  seedPeople(admins)
  seedCompanySettings()
  seedVendors()
  for (const project of PROJECTS) seedProject(project)
  seedInternalWorkspaces()
  seedChat()
  process.stdout.write(
    `-- Summit Ridge Builders demo seed, built ${now}. Demo database only.\n${statements.join("\n")}\n`,
  )
}

main()
