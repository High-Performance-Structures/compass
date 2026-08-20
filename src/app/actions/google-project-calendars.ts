"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  googleCalendarConnections,
  googleCalendarSelections,
  googleProjectCalendarAclMembers,
  googleProjectCalendars,
  googleProjectCalendarSubscriptions,
  organizationCalendarSettings,
  projectMembers,
  projects,
  users,
  workCalendarEvents,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import {
  addGoogleCalendarToList,
  createGoogleCalendar,
  deleteGoogleCalendar,
  deleteGoogleCalendarAclRule,
  listGoogleCalendarAclRules,
  upsertGoogleCalendarAclRule,
  type GoogleCalendarAclRule,
} from "@/lib/google/calendar/client"
import {
  getGoogleCalendarOAuthConfig,
  googleCalendarTokenSalt,
} from "@/lib/google/calendar/config"
import { hasRequiredGoogleCalendarScopes, refreshGoogleAccessToken } from "@/lib/google/calendar/oauth"
import {
  canDeleteGoogleProjectCalendar,
  canEnableGoogleProjectCalendar,
  googleProjectCalendarAclRole,
} from "@/lib/google/calendar/project-policy"
import {
  publishWorkCalendarEventToGoogle,
  syncGoogleCalendarSelection,
} from "@/lib/google/calendar/sync"
import { requireOrg } from "@/lib/org-scope"
import { getProjectAccessRecord } from "@/lib/project-access"
import { requirePermission } from "@/lib/permissions"

type Database = ReturnType<typeof getDb>

type ActionResult =
  | { readonly success: true; readonly warning?: string }
  | { readonly success: false; readonly error: string }

export type GoogleProjectCalendarStatus = {
  readonly canEnable: boolean
  readonly canDelete: boolean
  readonly ownerConfigured: boolean
  readonly ownerAccountEmail: string | null
  readonly connected: boolean
  readonly requiresReconnect: boolean
  readonly subscribed: boolean
  readonly calendar: null | {
    readonly summary: string
    readonly status: string
    readonly lastAclSyncedAt: string | null
    readonly lastSyncedAt: string | null
    readonly lastError: string | null
  }
}

type ConnectionRecord = {
  readonly id: string
  readonly userId: string
  readonly accountEmail: string
  readonly refreshTokenEncrypted: string
  readonly grantedScopes: string
}

function parsedScopes(value: string): readonly string[] {
  return value.split(/\s+/).filter(Boolean)
}

async function accessToken(
  env: object,
  connection: ConnectionRecord,
): Promise<string> {
  if (!hasRequiredGoogleCalendarScopes(parsedScopes(connection.grantedScopes))) {
    throw new Error("Reconnect Google Calendar in Settings to grant project calendar access.")
  }
  const configuration = getGoogleCalendarOAuthConfig(env)
  if (!configuration.configured) throw new Error("Google Calendar OAuth is not configured.")
  const refreshToken = await decrypt(
    connection.refreshTokenEncrypted,
    configuration.config.tokenEncryptionKey,
    googleCalendarTokenSalt(connection.userId),
  )
  return (await refreshGoogleAccessToken(configuration.config, refreshToken)).accessToken
}

async function ownerConnection(
  db: Database,
  organizationId: string,
): Promise<ConnectionRecord | null> {
  return db
    .select({
      id: googleCalendarConnections.id,
      userId: googleCalendarConnections.userId,
      accountEmail: googleCalendarConnections.googleAccountEmail,
      refreshTokenEncrypted: googleCalendarConnections.refreshTokenEncrypted,
      grantedScopes: googleCalendarConnections.grantedScopes,
    })
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.status, "connected"),
        eq(googleCalendarConnections.isOrganizationCalendarOwner, true),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function ownConnection(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<ConnectionRecord | null> {
  return db
    .select({
      id: googleCalendarConnections.id,
      userId: googleCalendarConnections.userId,
      accountEmail: googleCalendarConnections.googleAccountEmail,
      refreshTokenEncrypted: googleCalendarConnections.refreshTokenEncrypted,
      grantedScopes: googleCalendarConnections.grantedScopes,
    })
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.userId, userId),
        eq(googleCalendarConnections.status, "connected"),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function requireProject(
  db: Database,
  organizationId: string,
  user: Awaited<ReturnType<typeof requireAuth>>,
  projectId: string,
): Promise<{ readonly id: string; readonly name: string; readonly projectNumber: string | null }> {
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) {
    throw new Error("Project not found.")
  }
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")
  return project
}

function projectCalendarSummary(project: {
  readonly name: string
  readonly projectNumber: string | null
}): string {
  const label = project.projectNumber
    ? `${project.projectNumber} ${project.name}`
    : project.name
  return `Compass – ${label}`.slice(0, 240)
}

async function shareWithUser(input: {
  readonly db: Database
  readonly token: string
  readonly projectCalendarId: string
  readonly googleCalendarId: string
  readonly ownerEmail: string
  readonly knownRules?: readonly GoogleCalendarAclRule[]
  readonly user: { readonly id: string; readonly email: string; readonly role: string }
}): Promise<void> {
  if (input.user.email.toLowerCase() === input.ownerEmail.toLowerCase()) return
  const rule = await upsertGoogleCalendarAclRule(
    input.token,
    input.googleCalendarId,
    input.user.email,
    googleProjectCalendarAclRole(input.user.role),
    input.knownRules,
  )
  const now = new Date().toISOString()
  await input.db
    .insert(googleProjectCalendarAclMembers)
    .values({
      id: crypto.randomUUID(),
      projectCalendarId: input.projectCalendarId,
      userId: input.user.id,
      email: input.user.email.toLowerCase(),
      googleAclRuleId: rule.id,
      role: rule.role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [googleProjectCalendarAclMembers.projectCalendarId, googleProjectCalendarAclMembers.email],
      set: {
        userId: input.user.id,
        googleAclRuleId: rule.id,
        role: rule.role,
        updatedAt: now,
      },
    })
}

async function reconcileAccess(
  db: Database,
  token: string,
  calendar: {
    readonly id: string
    readonly organizationId: string
    readonly projectId: string
    readonly googleCalendarId: string
    readonly ownerEmail: string
  },
): Promise<void> {
  const members = await db
    .select({
      id: users.id,
      email: users.email,
      googleAccountEmail: googleCalendarConnections.googleAccountEmail,
      role: users.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .leftJoin(
      googleCalendarConnections,
      and(
        eq(googleCalendarConnections.userId, users.id),
        eq(
          googleCalendarConnections.organizationId,
          calendar.organizationId,
        ),
        eq(googleCalendarConnections.status, "connected"),
      ),
    )
    .where(
      and(
        eq(projectMembers.projectId, calendar.projectId),
        eq(users.isActive, true),
      ),
    )
  const desired = new Map<string, { readonly id: string; readonly email: string; readonly role: string }>()
  for (const member of members) {
    const normalized = {
      id: member.id,
      email: member.googleAccountEmail ?? member.email,
      role: member.role,
    }
    desired.set(normalized.email.toLowerCase(), normalized)
  }
  const subscribers = await db
    .select({
      id: users.id,
      email: googleCalendarConnections.googleAccountEmail,
      role: users.role,
    })
    .from(googleProjectCalendarSubscriptions)
    .innerJoin(users, eq(users.id, googleProjectCalendarSubscriptions.userId))
    .innerJoin(
      googleCalendarConnections,
      and(
        eq(
          googleCalendarConnections.id,
          googleProjectCalendarSubscriptions.connectionId,
        ),
        eq(
          googleCalendarConnections.organizationId,
          calendar.organizationId,
        ),
      ),
    )
    .where(
      eq(
        googleProjectCalendarSubscriptions.projectCalendarId,
        calendar.id,
      ),
    )
  for (const subscriber of subscribers) {
    desired.set(subscriber.email.toLowerCase(), subscriber)
  }
  desired.delete(calendar.ownerEmail.toLowerCase())
  const knownRules = await listGoogleCalendarAclRules(
    token,
    calendar.googleCalendarId,
  )

  for (const member of desired.values()) {
    await shareWithUser({
      db,
      token,
      projectCalendarId: calendar.id,
      googleCalendarId: calendar.googleCalendarId,
      ownerEmail: calendar.ownerEmail,
      user: member,
      knownRules,
    })
  }

  const tracked = await db
    .select({
      id: googleProjectCalendarAclMembers.id,
      email: googleProjectCalendarAclMembers.email,
      googleAclRuleId: googleProjectCalendarAclMembers.googleAclRuleId,
    })
    .from(googleProjectCalendarAclMembers)
    .where(eq(googleProjectCalendarAclMembers.projectCalendarId, calendar.id))
  for (const row of tracked) {
    if (desired.has(row.email.toLowerCase())) continue
    await deleteGoogleCalendarAclRule(token, calendar.googleCalendarId, row.googleAclRuleId)
    await db.delete(googleProjectCalendarAclMembers)
      .where(eq(googleProjectCalendarAclMembers.id, row.id))
  }
  const now = new Date().toISOString()
  await db.update(googleProjectCalendars).set({
    lastAclSyncedAt: now,
    lastError: null,
    updatedAt: now,
  }).where(eq(googleProjectCalendars.id, calendar.id))
}

export async function getGoogleProjectCalendarStatus(
  projectId: string,
): Promise<GoogleProjectCalendarStatus> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await requireProject(db, organizationId, user, projectId)
  const [owner, own, calendar] = await Promise.all([
    ownerConnection(db, organizationId),
    ownConnection(db, organizationId, user.id),
    db.select({
      id: googleProjectCalendars.id,
      summary: googleProjectCalendars.summary,
      status: googleProjectCalendars.status,
      lastAclSyncedAt: googleProjectCalendars.lastAclSyncedAt,
      lastSyncedAt: googleProjectCalendars.lastSyncedAt,
      lastError: googleProjectCalendars.lastError,
    }).from(googleProjectCalendars)
      .where(and(
        eq(googleProjectCalendars.organizationId, organizationId),
        eq(googleProjectCalendars.projectId, projectId),
      )).limit(1).then((rows) => rows[0] ?? null),
  ])
  const subscription = calendar
    ? await db.select({ id: googleProjectCalendarSubscriptions.id })
      .from(googleProjectCalendarSubscriptions)
      .where(and(
        eq(googleProjectCalendarSubscriptions.projectCalendarId, calendar.id),
        eq(googleProjectCalendarSubscriptions.userId, user.id),
      )).limit(1).then((rows) => rows[0] ?? null)
    : null
  return {
    canEnable: canEnableGoogleProjectCalendar(user.role),
    canDelete: canDeleteGoogleProjectCalendar(user.role),
    ownerConfigured: owner !== null,
    ownerAccountEmail: owner?.accountEmail ?? null,
    connected: own !== null,
    requiresReconnect: own !== null && !hasRequiredGoogleCalendarScopes(parsedScopes(own.grantedScopes)),
    subscribed: subscription !== null,
    calendar: calendar ? {
      summary: calendar.summary,
      status: calendar.status,
      lastAclSyncedAt: calendar.lastAclSyncedAt,
      lastSyncedAt: calendar.lastSyncedAt,
      lastError: calendar.lastError,
    } : null,
  }
}

export async function setOwnGoogleCalendarAsOrganizationOwner(): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canDeleteGoogleProjectCalendar(user.role)) {
      return { success: false, error: "Only an administrator or developer can designate the organization calendar account." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const connection = await ownConnection(db, organizationId, user.id)
    if (!connection) return { success: false, error: "Connect Google Calendar first." }
    if (!hasRequiredGoogleCalendarScopes(parsedScopes(connection.grantedScopes))) {
      return { success: false, error: "Reconnect Google Calendar first to grant project calendar access." }
    }
    const existingManagedCalendar = await db
      .select({ ownerConnectionId: googleProjectCalendars.ownerConnectionId })
      .from(googleProjectCalendars)
      .where(eq(googleProjectCalendars.organizationId, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (
      existingManagedCalendar &&
      existingManagedCalendar.ownerConnectionId !== connection.id
    ) {
      return {
        success: false,
        error: "Delete existing managed project calendars before changing the organization owner account.",
      }
    }
    await db.update(googleCalendarConnections)
      .set({ isOrganizationCalendarOwner: false, updatedAt: new Date().toISOString() })
      .where(eq(googleCalendarConnections.organizationId, organizationId))
    await db.update(googleCalendarConnections)
      .set({ isOrganizationCalendarOwner: true, updatedAt: new Date().toISOString() })
      .where(eq(googleCalendarConnections.id, connection.id))
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The organization calendar account could not be set." }
  }
}

export async function enableGoogleProjectCalendar(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "create")
    if (!canEnableGoogleProjectCalendar(user.role)) {
      return { success: false, error: "Project Google calendars can be enabled by office staff." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await requireProject(db, organizationId, user, projectId)
    const existing = await db.select({ id: googleProjectCalendars.id })
      .from(googleProjectCalendars).where(eq(googleProjectCalendars.projectId, projectId))
      .limit(1).then((rows) => rows[0] ?? null)
    if (existing) return { success: false, error: "This project already has a Google calendar." }
    const owner = await ownerConnection(db, organizationId)
    if (!owner) return { success: false, error: "An administrator must designate an organization Google Calendar account in Settings first." }
    const token = await accessToken(env, owner)
    const setting = await db.select({ timeZone: organizationCalendarSettings.timeZone })
      .from(organizationCalendarSettings)
      .where(eq(organizationCalendarSettings.organizationId, organizationId))
      .limit(1).then((rows) => rows[0] ?? null)
    const timeZone = setting?.timeZone ?? "America/Denver"
    const summary = projectCalendarSummary(project)
    const created = await createGoogleCalendar(token, {
      summary,
      description: "Compass-managed project calendar. Access follows Compass project permissions.",
      timeZone,
    })
    const now = new Date().toISOString()
    const selectionId = crypto.randomUUID()
    const projectCalendarId = crypto.randomUUID()
    try {
      await db.insert(googleCalendarSelections).values({
        id: selectionId,
        connectionId: owner.id,
        googleCalendarId: created.id,
        summary: created.summary,
        description: created.description,
        timeZone: created.timeZone ?? timeZone,
        backgroundColor: null,
        accessRole: "owner",
        isPrimary: false,
        selected: false,
        importEvents: false,
        exportCompassEvents: true,
        isCompassDestination: false,
        calendarScope: "organization",
        internalVisibility: "details",
        internalCanCreate: true,
        internalCanEdit: true,
        internalCanDelete: false,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(googleProjectCalendars).values({
        id: projectCalendarId,
        organizationId,
        projectId,
        ownerConnectionId: owner.id,
        selectionId,
        googleCalendarId: created.id,
        summary: created.summary,
        timeZone: created.timeZone ?? timeZone,
        status: "active",
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      try {
        await db.delete(googleCalendarSelections)
          .where(eq(googleCalendarSelections.id, selectionId))
      } catch {
        // The external calendar cleanup below is the higher-value rollback.
      }
      await deleteGoogleCalendar(token, created.id).catch(() => undefined)
      throw error
    }
    let accessWarning: string | null = null
    try {
      await reconcileAccess(db, token, {
        id: projectCalendarId,
        organizationId,
        projectId,
        googleCalendarId: created.id,
        ownerEmail: owner.accountEmail,
      })
    } catch (error) {
      accessWarning = error instanceof Error
        ? `Member access could not be synchronized: ${error.message}`
        : "Member access could not be synchronized."
    }
    const events = await db.select({ id: workCalendarEvents.id })
      .from(workCalendarEvents)
      .where(and(
        eq(workCalendarEvents.organizationId, organizationId),
        eq(workCalendarEvents.projectId, projectId),
        eq(workCalendarEvents.status, "open"),
      ))
    let failed = 0
    for (const event of events) {
      try {
        await publishWorkCalendarEventToGoogle(db, env, event.id, selectionId)
      } catch {
        failed += 1
      }
    }
    const eventWarning = failed > 0
      ? `${failed} existing event${failed === 1 ? "" : "s"} could not be published.`
      : null
    const warning = [accessWarning, eventWarning].filter(
      (message): message is string => message !== null,
    ).join(" ")
    await db.update(googleProjectCalendars).set({
      lastSyncedAt: new Date().toISOString(),
      lastError: warning || null,
      updatedAt: new Date().toISOString(),
    }).where(eq(googleProjectCalendars.id, projectCalendarId))
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    revalidatePath("/dashboard/schedule")
    return warning
      ? { success: true, warning }
      : { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The project Google calendar could not be enabled." }
  }
}

export async function setGoogleProjectCalendarPaused(
  projectId: string,
  paused: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canEnableGoogleProjectCalendar(user.role)) return { success: false, error: "Permission denied." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const updated = await db.update(googleProjectCalendars).set({
      status: paused ? "paused" : "active",
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(googleProjectCalendars.organizationId, organizationId),
      eq(googleProjectCalendars.projectId, projectId),
    )).returning({ id: googleProjectCalendars.id }).then((rows) => rows[0] ?? null)
    if (!updated) return { success: false, error: "Project Google calendar not found." }
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The project Google calendar could not be updated." }
  }
}

export async function setGoogleProjectCalendarDisabled(
  projectId: string,
  disabled: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canDeleteGoogleProjectCalendar(user.role)) {
      return { success: false, error: "Only an administrator or developer can disable a project Google calendar." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const updated = await db.update(googleProjectCalendars).set({
      status: disabled ? "disabled" : "active",
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(googleProjectCalendars.organizationId, organizationId),
      eq(googleProjectCalendars.projectId, projectId),
    )).returning({ id: googleProjectCalendars.id }).then((rows) => rows[0] ?? null)
    if (!updated) return { success: false, error: "Project Google calendar not found." }
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The project Google calendar could not be updated." }
  }
}

export async function syncGoogleProjectCalendarAccess(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canEnableGoogleProjectCalendar(user.role)) return { success: false, error: "Permission denied." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const owner = await ownerConnection(db, organizationId)
    if (!owner) return { success: false, error: "The organization Google Calendar account is not configured." }
    const calendar = await db.select({
      id: googleProjectCalendars.id,
      organizationId: googleProjectCalendars.organizationId,
      projectId: googleProjectCalendars.projectId,
      googleCalendarId: googleProjectCalendars.googleCalendarId,
    }).from(googleProjectCalendars).where(and(
      eq(googleProjectCalendars.organizationId, organizationId),
      eq(googleProjectCalendars.projectId, projectId),
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!calendar) return { success: false, error: "Project Google calendar not found." }
    await reconcileAccess(db, await accessToken(env, owner), {
      ...calendar,
      ownerEmail: owner.accountEmail,
    })
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Calendar access could not be synchronized." }
  }
}

export async function syncGoogleProjectCalendarEvents(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canEnableGoogleProjectCalendar(user.role)) return { success: false, error: "Permission denied." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const calendar = await db.select({
      id: googleProjectCalendars.id,
      selectionId: googleProjectCalendars.selectionId,
      status: googleProjectCalendars.status,
    }).from(googleProjectCalendars).where(and(
      eq(googleProjectCalendars.organizationId, organizationId),
      eq(googleProjectCalendars.projectId, projectId),
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!calendar) return { success: false, error: "Project Google calendar not found." }
    if (calendar.status !== "active") return { success: false, error: "Enable the project Google calendar before syncing events." }
    await syncGoogleCalendarSelection(db, env, calendar.selectionId)
    const now = new Date().toISOString()
    await db.update(googleProjectCalendars).set({
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(googleProjectCalendars.id, calendar.id))
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Project calendar events could not be synchronized." }
  }
}

export async function addGoogleProjectCalendarToMine(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const [owner, own, calendar] = await Promise.all([
      ownerConnection(db, organizationId),
      ownConnection(db, organizationId, user.id),
      db.select({
        id: googleProjectCalendars.id,
        googleCalendarId: googleProjectCalendars.googleCalendarId,
        status: googleProjectCalendars.status,
      }).from(googleProjectCalendars).where(and(
        eq(googleProjectCalendars.organizationId, organizationId),
        eq(googleProjectCalendars.projectId, projectId),
      )).limit(1).then((rows) => rows[0] ?? null),
    ])
    if (!calendar || calendar.status !== "active") return { success: false, error: "This project Google calendar is not active." }
    if (!owner) return { success: false, error: "The organization Google Calendar account is not configured." }
    if (!own) return { success: false, error: "Connect Google Calendar in Settings first." }
    const ownerToken = await accessToken(env, owner)
    await shareWithUser({
      db,
      token: ownerToken,
      projectCalendarId: calendar.id,
      googleCalendarId: calendar.googleCalendarId,
      ownerEmail: owner.accountEmail,
      user: { id: user.id, email: own.accountEmail, role: user.role },
    })
    await addGoogleCalendarToList(await accessToken(env, own), calendar.googleCalendarId)
    const now = new Date().toISOString()
    await db.insert(googleProjectCalendarSubscriptions).values({
      id: crypto.randomUUID(),
      projectCalendarId: calendar.id,
      userId: user.id,
      connectionId: own.id,
      subscribedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [googleProjectCalendarSubscriptions.projectCalendarId, googleProjectCalendarSubscriptions.userId],
      set: { connectionId: own.id, subscribedAt: now, updatedAt: now },
    })
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The project calendar could not be added to Google Calendar." }
  }
}

export async function deleteGoogleProjectCalendarForProject(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (!canDeleteGoogleProjectCalendar(user.role)) return { success: false, error: "Only an administrator or developer can delete a project Google calendar." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, organizationId, user, projectId)
    const owner = await ownerConnection(db, organizationId)
    const calendar = await db.select({
      id: googleProjectCalendars.id,
      selectionId: googleProjectCalendars.selectionId,
      googleCalendarId: googleProjectCalendars.googleCalendarId,
    }).from(googleProjectCalendars).where(and(
      eq(googleProjectCalendars.organizationId, organizationId),
      eq(googleProjectCalendars.projectId, projectId),
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!calendar) return { success: false, error: "Project Google calendar not found." }
    if (!owner) return { success: false, error: "The organization Google Calendar account is not configured." }
    await deleteGoogleCalendar(await accessToken(env, owner), calendar.googleCalendarId)
    await db.delete(googleProjectCalendars).where(eq(googleProjectCalendars.id, calendar.id))
    await db.delete(googleCalendarSelections).where(eq(googleCalendarSelections.id, calendar.selectionId))
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The project Google calendar could not be deleted." }
  }
}
