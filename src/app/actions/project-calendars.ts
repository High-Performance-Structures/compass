"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  compassProjectCalendarEvents,
  compassProjectCalendarMembers,
  compassProjectCalendars,
  projects,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { upsertProjectCalendarChoice } from "@/lib/domain/calendars/store"
import { getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { canEnableGoogleProjectCalendar } from "@/lib/google/calendar/project-policy"
import { requireOrg } from "@/lib/org-scope"
import {
  organizationTimeZone,
  projectCalendarIncluded,
  PROJECT_CALENDAR_OWNER_SCOPES,
  removeProjectCalendar,
  syncProjectCalendar,
} from "@/lib/project-calendars/sync"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type ProjectCalendarStatus =
  | { readonly available: false }
  | {
      readonly available: true
      readonly mode: "off" | "selected" | "open"
      readonly included: boolean
      /** Staff choice for this job; null follows the company setting. */
      readonly choice: boolean | null
      readonly canManage: boolean
      readonly status: "pending" | "active" | "error" | null
      readonly calendarUrl: string | null
      readonly eventCount: number
      readonly memberCount: number
      readonly sharedWithMe: boolean
      readonly lastSyncedAt: string | null
      readonly lastError: string | null
    }

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

type Context = {
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly status: string | null
  }
}

async function context(projectId: string): Promise<Context | null> {
  const user = await requireAuth()
  // Project calendars are staff-only; clients and vendors never see them.
  if (!isInternalStaffRole(user.role) && user.role !== "developer") return null
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) return null
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return project ? { db, env, user, organizationId, project } : null
}

async function calendarRow(ctx: Context): Promise<typeof compassProjectCalendars.$inferSelect | null> {
  return ctx.db
    .select()
    .from(compassProjectCalendars)
    .where(eq(compassProjectCalendars.projectId, ctx.project.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function getProjectCalendarStatus(projectId: string): Promise<Result<ProjectCalendarStatus>> {
  try {
    const ctx = await context(projectId)
    if (!ctx) return { success: true, data: { available: false } }
    const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "project-calendars")
    const row = await calendarRow(ctx)
    const [events, members] = row
      ? await Promise.all([
          ctx.db
            .select({ id: compassProjectCalendarEvents.id })
            .from(compassProjectCalendarEvents)
            .where(eq(compassProjectCalendarEvents.projectId, projectId)),
          ctx.db
            .select({ userId: compassProjectCalendarMembers.userId })
            .from(compassProjectCalendarMembers)
            .where(eq(compassProjectCalendarMembers.projectId, projectId)),
        ])
      : [[], []]
    const status = row?.status === "active" || row?.status === "error" || row?.status === "pending" ? row.status : null
    return {
      success: true,
      data: {
        available: true,
        mode: settings.mode,
        included: projectCalendarIncluded(settings, ctx.project, row),
        choice: row?.enabled ?? null,
        canManage: canEnableGoogleProjectCalendar(ctx.user.role),
        status,
        calendarUrl: row?.googleCalendarId
          ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(row.googleCalendarId)}`
          : null,
        eventCount: events.length,
        memberCount: members.length,
        sharedWithMe: members.some((member) => member.userId === ctx.user.id),
        lastSyncedAt: row?.lastSyncedAt ?? null,
        lastError: row?.lastError ?? null,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the project calendar.") }
  }
}

async function syncNow(ctx: Context): Promise<void> {
  const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "project-calendars")
  const workspace = await ctx.db
    .select({ domain: googleAuth.workspaceDomain })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, ctx.organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!workspace) throw new Error("Google Workspace isn't connected for this company.")
  const row = await calendarRow(ctx)
  const token = await getCompassGmailAccessToken({
    env: ctx.env,
    db: ctx.db,
    organizationId: ctx.organizationId,
    scopes: [...PROJECT_CALENDAR_OWNER_SCOPES],
    sender: row?.googleCalendarId && row.ownerEmail ? row.ownerEmail : undefined,
  })
  if (!token.success) throw new Error(token.error)
  await syncProjectCalendar({
    db: ctx.db,
    env: ctx.env,
    settings,
    workspaceDomain: workspace.domain,
    timeZone: await organizationTimeZone(ctx.db, ctx.organizationId),
    project: { ...ctx.project, organizationId: ctx.organizationId },
    owner: { accessToken: token.accessToken, email: token.sender.toLowerCase() },
    writeBudget: 150,
  })
}

/**
 * Staff choice for this job: true makes the calendar now, false deletes it
 * from Google, null goes back to the company setting.
 */
export async function setProjectCalendarChoice(projectId: string, choice: boolean | null): Promise<Result<null>> {
  try {
    const ctx = await context(projectId)
    if (!ctx) return { success: false, error: "Project not found." }
    if (isDemoUser(ctx.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    if (!canEnableGoogleProjectCalendar(ctx.user.role)) {
      return { success: false, error: "Office staff can turn project calendars on or off." }
    }
    const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "project-calendars")
    if (settings.mode === "off") return { success: false, error: "An administrator hasn't turned on project calendars yet." }
    const now = new Date().toISOString()
    await upsertProjectCalendarChoice(ctx.db, {
      projectId,
      organizationId: ctx.organizationId,
      enabled: choice,
      userId: ctx.user.id,
      now,
    })
    const row = await calendarRow(ctx)
    if (!row) throw new Error("The project calendar setting could not be saved.")
    if (projectCalendarIncluded(settings, ctx.project, row)) {
      await syncNow(ctx)
    } else if (row.googleCalendarId) {
      await removeProjectCalendar({ db: ctx.db, env: ctx.env, row })
    }
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not update the project calendar.") }
  }
}

export async function syncProjectCalendarNow(projectId: string): Promise<Result<null>> {
  try {
    const ctx = await context(projectId)
    if (!ctx) return { success: false, error: "Project not found." }
    if (isDemoUser(ctx.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "project-calendars")
    const row = await calendarRow(ctx)
    if (!projectCalendarIncluded(settings, ctx.project, row)) {
      return { success: false, error: "This job doesn't have a project calendar." }
    }
    await syncNow(ctx)
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "The project calendar could not be updated.") }
  }
}
