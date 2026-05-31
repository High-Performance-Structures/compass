import { NextRequest, NextResponse } from "next/server"
import { getCloudflareContext } from "@/lib/db"
import { drizzle } from "drizzle-orm/d1"
import { eq, and } from "drizzle-orm"
import { z } from "zod/v4"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import {
  localSyncMetadata,
  SyncStatus,
} from "@/lib/sync/schema"
import {
  detectConflict,
  resolveConflict,
  ConflictStrategy,
} from "@/lib/sync/conflict"
import {
  serializeClock,
  parseClock,
  type VectorClockValue,
} from "@/lib/sync/clock"
import {
  projects,
  scheduleTasks,
  taskDependencies,
  users,
  organizations,
  teams,
  groups,
  projectMembers,
  organizationMembers,
} from "@/db/schema"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"

const VectorClockSchema = z.record(z.string(), z.number())

// Field allowlists for each syncable table - prevents mass assignment
const FIELD_ALLOWLISTS = {
  projects: [
    "name",
    "status",
    "address",
    "clientName",
    "projectManager",
    "organizationId",
    "netsuiteJobId",
  ] as const,
  scheduleTasks: [
    "projectId",
    "title",
    "startDate",
    "workdays",
    "endDateCalculated",
    "phase",
    "status",
    "isCriticalPath",
    "isMilestone",
    "percentComplete",
    "assignedTo",
    "sortOrder",
  ] as const,
  taskDependencies: ["predecessorId", "successorId", "type", "lagDays"] as const,
  users: [
    "email",
    "firstName",
    "lastName",
    "displayName",
    "avatarUrl",
    "role",
    "googleEmail",
    "isActive",
    "lastLoginAt",
  ] as const,
  organizations: ["name", "slug", "type", "logoUrl", "isActive"] as const,
  teams: ["organizationId", "name", "description"] as const,
  groups: ["organizationId", "name", "description", "color"] as const,
} as const

// TableAllowlist type available for future use if needed
// type TableAllowlist = (typeof FIELD_ALLOWLISTS)[keyof typeof FIELD_ALLOWLISTS]

// Zod schemas for payload validation per table
const ProjectPayloadSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  address: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  projectManager: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  netsuiteJobId: z.string().nullable().optional(),
})

const ScheduleTaskPayloadSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().optional(),
  startDate: z.string().optional(),
  workdays: z.number().optional(),
  endDateCalculated: z.string().optional(),
  phase: z.string().optional(),
  status: z.string().optional(),
  isCriticalPath: z.boolean().optional(),
  isMilestone: z.boolean().optional(),
  percentComplete: z.number().optional(),
  assignedTo: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
})

const TaskDependencyPayloadSchema = z.object({
  predecessorId: z.string().optional(),
  successorId: z.string().optional(),
  type: z.string().optional(),
  lagDays: z.number().optional(),
})

const UserPayloadSchema = z.object({
  email: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  role: z.string().optional(),
  googleEmail: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  lastLoginAt: z.string().nullable().optional(),
})

const OrganizationPayloadSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  type: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

const TeamPayloadSchema = z.object({
  organizationId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
})

const GroupPayloadSchema = z.object({
  organizationId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
})

const PayloadSchemas = {
  projects: ProjectPayloadSchema,
  scheduleTasks: ScheduleTaskPayloadSchema,
  taskDependencies: TaskDependencyPayloadSchema,
  users: UserPayloadSchema,
  organizations: OrganizationPayloadSchema,
  teams: TeamPayloadSchema,
  groups: GroupPayloadSchema,
} as const

// Maps table names to permission resources
const TABLE_TO_RESOURCE = {
  projects: "project" as const,
  scheduleTasks: "schedule" as const,
  taskDependencies: "schedule" as const,
  users: "user" as const,
  organizations: "organization" as const,
  teams: "team" as const,
  groups: "group" as const,
} as const

const MutateRequestSchema = z.object({
  operation: z.enum(["insert", "update", "delete"]),
  table: z.string(),
  recordId: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  vectorClock: VectorClockSchema,
})

type MutateResponse =
  | { success: true }
  | { error: "conflict"; serverData: Record<string, unknown> }
  | { error: "invalid request"; details?: unknown }
  | { error: "unauthorized" }
  | { error: "forbidden"; reason?: string }
  | { error: "table not supported" }
  | { error: "internal error"; message?: string }

const SYNCABLE_TABLES = new Set([
  "projects",
  "scheduleTasks",
  "taskDependencies",
  "users",
  "organizations",
  "teams",
  "groups",
])

// Filter payload to only include allowed fields for a table
function filterPayloadFields(
  table: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowlist = FIELD_ALLOWLISTS[table as keyof typeof FIELD_ALLOWLISTS]
  if (!allowlist) {
    return {}
  }
  const filtered: Record<string, unknown> = {}
  for (const key of allowlist) {
    if (key in payload) {
      filtered[key] = payload[key]
    }
  }
  return filtered
}

// Validate payload against Zod schema for the table
function validatePayload(
  table: string,
  payload: Record<string, unknown>,
): { success: true; data: Record<string, unknown> } | { success: false; error: unknown } {
  const schema = PayloadSchemas[table as keyof typeof PayloadSchemas]
  if (!schema) {
    return { success: false, error: "No schema for table" }
  }
  const result = schema.safeParse(payload)
  if (!result.success) {
    return { success: false, error: result.error.issues }
  }
  return { success: true, data: result.data }
}

// Map operation to permission action
function operationToAction(
  operation: "insert" | "update" | "delete",
): "create" | "update" | "delete" {
  switch (operation) {
    case "insert":
      return "create"
    case "update":
      return "update"
    case "delete":
      return "delete"
  }
}

// Check if user has access to a specific project
async function checkProjectAccess(
  db: ReturnType<typeof drizzle>,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const membership = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
    .limit(1)
  return membership.length > 0
}

// Check if user has access to an organization
async function checkOrganizationAccess(
  db: ReturnType<typeof drizzle>,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .limit(1)
  return membership.length > 0
}

// Resource-specific authorization check
async function checkResourceAuthorization(
  db: ReturnType<typeof drizzle>,
  userId: string,
  table: string,
  operation: "insert" | "update" | "delete",
  payload: Record<string, unknown> | null,
  recordId: string,
): Promise<{ authorized: boolean; reason?: string }> {
  const resource = TABLE_TO_RESOURCE[table as keyof typeof TABLE_TO_RESOURCE]
  if (!resource) {
    return { authorized: false, reason: "Unknown resource type" }
  }

  // Get user for role-based permission check
  const userRecords = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const dbUser = userRecords[0]
  if (!dbUser) {
    return { authorized: false, reason: "User not found" }
  }

  // Convert DB user to AuthUser for permission check (org fields not used by can())
  const user = {
    ...dbUser,
    organizationId: null,
    organizationName: null,
    organizationType: null,
  }

  const action = operationToAction(operation)

  // Check role-based permission
  if (!can(user, resource, action)) {
    return { authorized: false, reason: `Role ${user.role} cannot ${action} ${resource}` }
  }

  // For project-related resources, check project membership
  if (table === "scheduleTasks" || table === "taskDependencies") {
    let projectId: string | undefined
    if (table === "scheduleTasks") {
      projectId = payload?.projectId as string | undefined
      if (!projectId && operation !== "insert") {
        // For updates/deletes, fetch the task to get projectId
        const task = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.id, recordId))
          .limit(1)
        projectId = task[0]?.projectId
      }
    } else if (table === "taskDependencies") {
      // For dependencies, get the task's project
      // First try to find the dependency itself
      const dep = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.id, recordId))
        .limit(1)
      if (dep[0]) {
        const task = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.id, dep[0].predecessorId))
          .limit(1)
        projectId = task[0]?.projectId
      } else if (payload?.predecessorId) {
        const task = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.id, payload.predecessorId as string))
          .limit(1)
        projectId = task[0]?.projectId
      }
    }
    if (projectId && !(await checkProjectAccess(db, userId, projectId))) {
      return { authorized: false, reason: "No access to project" }
    }
  }

  // For projects, check organization membership
  if (table === "projects") {
    let organizationId = payload?.organizationId as string | undefined
    if (!organizationId && operation !== "insert") {
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, recordId))
        .limit(1)
      organizationId = project[0]?.organizationId ?? undefined
    }
    if (organizationId && !(await checkOrganizationAccess(db, userId, organizationId))) {
      return { authorized: false, reason: "No access to organization" }
    }
  }

  // For teams and groups, check organization membership
  if (table === "teams" || table === "groups") {
    const organizationId = payload?.organizationId as string | undefined
    if (organizationId && !(await checkOrganizationAccess(db, userId, organizationId))) {
      return { authorized: false, reason: "No access to organization" }
    }
  }

  return { authorized: true }
}

type TableHandler = {
  table: SQLiteTable
  idColumn: unknown
  fetchRecord: (
    db: ReturnType<typeof drizzle>,
    recordId: string,
  ) => Promise<Record<string, unknown> | null>
  applyInsert: (
    db: ReturnType<typeof drizzle>,
    recordId: string,
    payload: Record<string, unknown>,
    now: string,
  ) => Promise<void>
  applyUpdate: (
    db: ReturnType<typeof drizzle>,
    recordId: string,
    payload: Record<string, unknown>,
    now: string,
  ) => Promise<void>
  applyDelete: (
    db: ReturnType<typeof drizzle>,
    recordId: string,
  ) => Promise<void>
}

const TABLE_HANDLERS: Record<string, TableHandler> = {
  projects: {
    table: projects,
    idColumn: projects.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(projects)
        .where(eq(projects.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(projects).values({
        id: recordId,
        name: payload.name as string,
        status: (payload.status as string) ?? "OPEN",
        address: payload.address as string | null ?? null,
        clientName: payload.clientName as string | null ?? null,
        projectManager: payload.projectManager as string | null ?? null,
        organizationId: payload.organizationId as string | null ?? null,
        netsuiteJobId: payload.netsuiteJobId as string | null ?? null,
        createdAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, now) => {
      const updateData: Record<string, unknown> = { ...payload, updatedAt: now }
      delete updateData.id
      delete updateData.createdAt
      await db.update(projects).set(updateData).where(eq(projects.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(projects).where(eq(projects.id, recordId))
    },
  },
  scheduleTasks: {
    table: scheduleTasks,
    idColumn: scheduleTasks.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(scheduleTasks)
        .where(eq(scheduleTasks.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(scheduleTasks).values({
        id: recordId,
        projectId: payload.projectId as string,
        title: payload.title as string,
        startDate: payload.startDate as string,
        workdays: payload.workdays as number,
        endDateCalculated: payload.endDateCalculated as string,
        phase: payload.phase as string,
        status: (payload.status as string) ?? "PENDING",
        isCriticalPath: payload.isCriticalPath as boolean ?? false,
        isMilestone: payload.isMilestone as boolean ?? false,
        percentComplete: payload.percentComplete as number ?? 0,
        assignedTo: payload.assignedTo as string | null ?? null,
        sortOrder: payload.sortOrder as number ?? 0,
        createdAt: now,
        updatedAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, now) => {
      const updateData: Record<string, unknown> = { ...payload, updatedAt: now }
      delete updateData.id
      delete updateData.createdAt
      await db.update(scheduleTasks).set(updateData).where(eq(scheduleTasks.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(scheduleTasks).where(eq(scheduleTasks.id, recordId))
    },
  },
  taskDependencies: {
    table: taskDependencies,
    idColumn: taskDependencies.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, _now) => {
      await db.insert(taskDependencies).values({
        id: recordId,
        predecessorId: payload.predecessorId as string,
        successorId: payload.successorId as string,
        type: (payload.type as string) ?? "FS",
        lagDays: payload.lagDays as number ?? 0,
      })
    },
    applyUpdate: async (db, recordId, payload, _now) => {
      const updateData: Record<string, unknown> = { ...payload }
      delete updateData.id
      await db.update(taskDependencies).set(updateData).where(eq(taskDependencies.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(taskDependencies).where(eq(taskDependencies.id, recordId))
    },
  },
  users: {
    table: users,
    idColumn: users.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(users)
        .where(eq(users.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(users).values({
        id: recordId,
        email: payload.email as string,
        firstName: payload.firstName as string | null ?? null,
        lastName: payload.lastName as string | null ?? null,
        displayName: payload.displayName as string | null ?? null,
        avatarUrl: payload.avatarUrl as string | null ?? null,
        role: (payload.role as string) ?? "office",
        googleEmail: payload.googleEmail as string | null ?? null,
        isActive: payload.isActive as boolean ?? true,
        lastLoginAt: payload.lastLoginAt as string | null ?? null,
        createdAt: now,
        updatedAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, now) => {
      const updateData: Record<string, unknown> = { ...payload, updatedAt: now }
      delete updateData.id
      delete updateData.createdAt
      await db.update(users).set(updateData).where(eq(users.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(users).where(eq(users.id, recordId))
    },
  },
  organizations: {
    table: organizations,
    idColumn: organizations.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(organizations).values({
        id: recordId,
        name: payload.name as string,
        slug: payload.slug as string,
        type: payload.type as string,
        logoUrl: payload.logoUrl as string | null ?? null,
        isActive: payload.isActive as boolean ?? true,
        createdAt: now,
        updatedAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, now) => {
      const updateData: Record<string, unknown> = { ...payload, updatedAt: now }
      delete updateData.id
      delete updateData.createdAt
      await db.update(organizations).set(updateData).where(eq(organizations.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(organizations).where(eq(organizations.id, recordId))
    },
  },
  teams: {
    table: teams,
    idColumn: teams.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(teams)
        .where(eq(teams.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(teams).values({
        id: recordId,
        organizationId: payload.organizationId as string,
        name: payload.name as string,
        description: payload.description as string | null ?? null,
        createdAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, _now) => {
      const updateData: Record<string, unknown> = { ...payload }
      delete updateData.id
      delete updateData.createdAt
      await db.update(teams).set(updateData).where(eq(teams.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(teams).where(eq(teams.id, recordId))
    },
  },
  groups: {
    table: groups,
    idColumn: groups.id,
    fetchRecord: async (db, recordId) => {
      const records = await db
        .select()
        .from(groups)
        .where(eq(groups.id, recordId))
        .limit(1)
      return (records[0] as Record<string, unknown>) ?? null
    },
    applyInsert: async (db, recordId, payload, now) => {
      await db.insert(groups).values({
        id: recordId,
        organizationId: payload.organizationId as string,
        name: payload.name as string,
        description: payload.description as string | null ?? null,
        color: payload.color as string | null ?? null,
        createdAt: now,
      })
    },
    applyUpdate: async (db, recordId, payload, _now) => {
      const updateData: Record<string, unknown> = { ...payload }
      delete updateData.id
      delete updateData.createdAt
      await db.update(groups).set(updateData).where(eq(groups.id, recordId))
    },
    applyDelete: async (db, recordId) => {
      await db.delete(groups).where(eq(groups.id, recordId))
    },
  },
}

export async function POST(request: NextRequest): Promise<NextResponse<MutateResponse>> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "invalid request", details: "Invalid JSON body" },
      { status: 400 },
    )
  }

  const parseResult = MutateRequestSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "invalid request", details: parseResult.error.issues },
      { status: 400 },
    )
  }

  const { operation, table, recordId, payload, vectorClock } = parseResult.data

  if (!SYNCABLE_TABLES.has(table)) {
    return NextResponse.json(
      { error: "table not supported" },
      { status: 400 },
    )
  }

  const handler = TABLE_HANDLERS[table]
  if (!handler) {
    return NextResponse.json(
      { error: "table not supported" },
      { status: 400 },
    )
  }

  // Filter and validate payload to prevent mass assignment
  let filteredPayload: Record<string, unknown> = {}
  if (payload) {
    filteredPayload = filterPayloadFields(table, payload)
    const validation = validatePayload(table, filteredPayload)
    if (!validation.success) {
      return NextResponse.json(
        { error: "invalid request", details: validation.error },
        { status: 400 },
      )
    }
    filteredPayload = validation.data
  }

  const { env } = await getCloudflareContext()
  const db = drizzle(env.DB)

  // Authorization check
  const authResult = await checkResourceAuthorization(
    db,
    user.id,
    table,
    operation,
    filteredPayload,
    recordId,
  )
  if (!authResult.authorized) {
    return NextResponse.json(
      { error: "forbidden", reason: authResult.reason },
      { status: 403 },
    )
  }

  try {
    const existingMetadata = await db
      .select()
      .from(localSyncMetadata)
      .where(
        and(
          eq(localSyncMetadata.tableName, table),
          eq(localSyncMetadata.recordId, recordId),
        ),
      )
      .limit(1)

    const serverMetadata = existingMetadata[0]

    if (serverMetadata) {
      const conflictResult = detectConflict(
        serverMetadata.vectorClock,
        serializeClock(vectorClock),
      )

      if (conflictResult.hasConflict) {
        const serverRecord = await handler.fetchRecord(db, recordId)

        const resolution = resolveConflict(
          ConflictStrategy.NEWEST_WINS,
          serverRecord ?? {},
          filteredPayload,
          parseClock(serverMetadata.vectorClock),
          vectorClock,
          serverMetadata.lastModifiedAt,
          new Date().toISOString(),
        )

        if (resolution.resolution === "flag_manual") {
          return NextResponse.json(
            {
              error: "conflict",
              serverData: {
                data: serverRecord,
                vectorClock: parseClock(serverMetadata.vectorClock),
                lastModifiedAt: serverMetadata.lastModifiedAt,
              },
            },
            { status: 409 },
          )
        }

        if (resolution.resolution === "use_local") {
          await applyMutationWithHandler(
            db,
            handler,
            table,
            operation,
            recordId,
            filteredPayload,
            vectorClock,
          )
          return NextResponse.json({ success: true })
        }
      }
    }

    await applyMutationWithHandler(
      db,
      handler,
      table,
      operation,
      recordId,
      filteredPayload,
      vectorClock,
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Mutation error:", err)
    return NextResponse.json(
      { error: "internal error", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

async function applyMutationWithHandler(
  db: ReturnType<typeof drizzle>,
  handler: TableHandler,
  tableName: string,
  operation: "insert" | "update" | "delete",
  recordId: string,
  payload: Record<string, unknown> | null,
  vectorClock: VectorClockValue,
): Promise<void> {
  const now = new Date().toISOString()
  const clockJson = serializeClock(vectorClock)

  if (operation === "delete") {
    await handler.applyDelete(db, recordId)

    const existingMetadata = await db
      .select()
      .from(localSyncMetadata)
      .where(
        and(
          eq(localSyncMetadata.tableName, tableName),
          eq(localSyncMetadata.recordId, recordId),
        ),
      )
      .limit(1)

    if (existingMetadata[0]) {
      await db
        .update(localSyncMetadata)
        .set({
          vectorClock: clockJson,
          lastModifiedAt: now,
          syncStatus: SyncStatus.SYNCED,
        })
        .where(eq(localSyncMetadata.id, existingMetadata[0].id))
    }
    return
  }

  if (operation === "insert") {
    await handler.applyInsert(db, recordId, payload ?? {}, now)

    await db.insert(localSyncMetadata).values({
      tableName,
      recordId,
      vectorClock: clockJson,
      lastModifiedAt: now,
      syncStatus: SyncStatus.SYNCED,
      createdAt: now,
    })
    return
  }

  if (operation === "update") {
    await handler.applyUpdate(db, recordId, payload ?? {}, now)

    const existingMetadata = await db
      .select()
      .from(localSyncMetadata)
      .where(
        and(
          eq(localSyncMetadata.tableName, tableName),
          eq(localSyncMetadata.recordId, recordId),
        ),
      )
      .limit(1)

    if (existingMetadata[0]) {
      await db
        .update(localSyncMetadata)
        .set({
          vectorClock: clockJson,
          lastModifiedAt: now,
          syncStatus: SyncStatus.SYNCED,
        })
        .where(eq(localSyncMetadata.id, existingMetadata[0].id))
    } else {
      await db.insert(localSyncMetadata).values({
        tableName,
        recordId,
        vectorClock: clockJson,
        lastModifiedAt: now,
        syncStatus: SyncStatus.SYNCED,
        createdAt: now,
      })
    }
  }
}
