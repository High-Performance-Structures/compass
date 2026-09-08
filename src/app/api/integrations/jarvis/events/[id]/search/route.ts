import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogs,
  ownerProjectUpdates,
  projectDuplicateDecisions,
  projectJobStatuses,
  projectRegistryRemovals,
  projectRfis,
  projectRouteAliases,
  projects,
} from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  canSearchCompassRole,
  currentProjectIdFromPath,
  dailyLogHref,
  estimateHref,
  feedbackRequestHref,
  isProjectScopedJarvisCalendarSearch,
  jarvisSearchQueryForConversation,
  jarvisSearchTerms,
  ownerUpdateHref,
  projectHref,
  projectIdsForJarvisCalendarSearch,
  projectIdsForJarvisProjectSearch,
  projectIdsForJarvisSearch,
  requestedCalendarDate,
  requestedProjectStatus,
  rfiHref,
  requestedJarvisSearchKinds,
  type JarvisCompassSearchKind,
  type JarvisCompassSearchResult,
} from "@/lib/jarvis/search"
import {
  parseJarvisReadCapabilities,
  type JarvisReadCapability,
} from "@/lib/jarvis/read-capabilities"
import { searchJarvisCalendar } from "@/lib/jarvis/calendar-search"
import {
  projectJobStatusBucket,
  projectJobStatusLabel,
} from "@/lib/project-profile"
import {
  feedbackStaffStage,
  feedbackStatusLabel,
} from "@/lib/jarvis/feedback-lifecycle"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function recordString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function eventPayload(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function recentUserMessages(
  payload: Record<string, unknown>
): readonly string[] {
  const messages = payload.messages
  if (!Array.isArray(messages)) return []

  const userMessages: string[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== "user") continue
    const content = recordString(message, "content")?.trim() ?? ""
    if (content.length > 0) userMessages.push(content.slice(0, 2_000))
  }
  return userMessages.slice(-2)
}

function payloadContextValue(
  payload: Record<string, unknown>,
  key: string
): string | null {
  const context = payload.context
  return isRecord(context) ? recordString(context, key) : null
}

function payloadUserRole(payload: Record<string, unknown>): string | null {
  const user = payload.user
  return isRecord(user) ? recordString(user, "role") : null
}

function payloadUserEmail(payload: Record<string, unknown>): string | null {
  const user = payload.user
  if (!isRecord(user)) return null
  const email = recordString(user, "email")?.trim().toLowerCase() ?? ""
  return email.length > 0 ? email : null
}

function payloadUserId(payload: Record<string, unknown>): string | null {
  const user = payload.user
  return isRecord(user) ? recordString(user, "id") : null
}

function payloadReadCapabilities(
  payload: Record<string, unknown>,
): ReadonlySet<JarvisReadCapability> {
  const access = payload.access
  return isRecord(access)
    ? parseJarvisReadCapabilities(access.readCapabilities)
    : new Set()
}

function capabilitiesForKind(
  kind: JarvisCompassSearchKind,
): readonly JarvisReadCapability[] {
  switch (kind) {
    case "project":
      return ["project-hub"]
    case "daily_log":
      return ["project-hub", "daily-logs"]
    case "rfi":
      return ["project-hub", "rfis"]
    case "owner_update":
      return ["project-hub", "owner-updates"]
    case "estimate":
      return ["project-hub", "budget"]
    case "calendar_event":
      return ["work-calendar"]
    case "feedback_request":
      return []
  }
}

function cleanSummary(...values: readonly (string | null)[]): string {
  const summary = values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" · ")
    .replace(/\s+/g, " ")
  return summary.slice(0, 700)
}

function absoluteResult(
  origin: string,
  result: JarvisCompassSearchResult
): JarvisCompassSearchResult & { readonly url: string } {
  return {
    ...result,
    url: new URL(result.href, origin).toString(),
  }
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    readonly params: Promise<{ readonly id: string }>
  }
): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 }
    )
  }

  const verification = await verifyJarvisRequest(request, secrets, "")
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  const { id } = await params
  const db = getDb(env.DB)
  const event = await db
    .select({
      organizationId: jarvisBridgeEvents.organizationId,
      eventType: jarvisBridgeEvents.eventType,
      direction: jarvisBridgeEvents.direction,
      payload: jarvisBridgeEvents.payload,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.id, id),
        eq(jarvisBridgeEvents.direction, "outbound"),
        eq(jarvisBridgeEvents.eventType, "agent.prompt")
      )
    )
    .get()

  if (!event || !event.organizationId) {
    return Response.json({ error: "Agent event not found" }, { status: 404 })
  }

  const payload = eventPayload(event.payload)
  const role = payload ? payloadUserRole(payload) : null
  if (!payload || !role || !canSearchCompassRole(role)) {
    return Response.json(
      { error: "Compass search is unavailable for this account" },
      { status: 403 }
    )
  }

  const query = jarvisSearchQueryForConversation(
    recentUserMessages(payload)
  )
  if (query.length === 0) {
    return Response.json({ query: "", results: [], count: 0 })
  }

  const requestedKinds = requestedJarvisSearchKinds(query)
  const readCapabilities = payloadReadCapabilities(payload)
  const kinds = requestedKinds.filter((kind) =>
    capabilitiesForKind(kind).every((capability) =>
      readCapabilities.has(capability),
    ),
  )
  const kindsSet = new Set(kinds)
  const deniedKinds = requestedKinds.filter((kind) => !kindsSet.has(kind))
  const results: JarvisCompassSearchResult[] = []
  let sourceComplete = true

  const visibleProjectCondition = and(
    notExists(
      db
        .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
        .from(projectRouteAliases)
        .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
    ),
    notExists(
      db
        .select({ projectId: projectRegistryRemovals.projectId })
        .from(projectRegistryRemovals)
        .where(eq(projectRegistryRemovals.projectId, projects.id)),
    ),
    notExists(
      db
        .select({ removedProjectId: projectDuplicateDecisions.removedProjectId })
        .from(projectDuplicateDecisions)
        .where(
          and(
            eq(projectDuplicateDecisions.status, "merged"),
            eq(projectDuplicateDecisions.removedProjectId, projects.id),
          ),
        ),
    ),
  )

  if (kindsSet.has("feedback_request")) {
    const email = payloadUserEmail(payload)
    if (!email) {
      return Response.json(
        { error: "A verified staff email is required for request status" },
        { status: 403 },
      )
    }

    const terms = jarvisSearchTerms(query)
    const rows = await db
      .select({
        id: feedbackDeskItems.id,
        kind: feedbackDeskItems.kind,
        status: feedbackDeskItems.status,
        title: feedbackDeskItems.title,
        description: feedbackDeskItems.description,
        updatedAt: feedbackDeskItems.updatedAt,
      })
      .from(feedbackDeskItems)
      .where(
        and(
          eq(feedbackDeskItems.organizationId, event.organizationId),
          sql`lower(${feedbackDeskItems.reporterEmail}) = ${email}`,
        ),
      )
      .orderBy(desc(feedbackDeskItems.updatedAt))
      .limit(100)

    const matchingRows =
      terms.length === 0
        ? rows
        : rows.filter((row) => {
            const searchable =
              `${row.title} ${row.description}`.toLowerCase()
            return terms.some((term) => searchable.includes(term))
          })

    for (const row of matchingRows.slice(0, 15)) {
      results.push({
        kind: "feedback_request",
        title: row.title,
        summary:
          `${feedbackStatusLabel(row.status)} · ${row.kind} · ` +
          cleanSummary(row.description),
        projectName: "Compass Feedback Desk",
        projectNumber: null,
        date: row.updatedAt,
        status: row.status,
        href: feedbackRequestHref(row.id),
        verified: true,
        lifecycleStage: feedbackStaffStage(row.status),
      })
    }

    const origin = new URL(request.url).origin
    const verifiedAt = new Date().toISOString()
    return Response.json({
      query,
      scope: {
        kinds,
        requester: "authenticated_staff",
      },
      results: results.map((result) => absoluteResult(origin, result)),
      count: results.length,
      complete: matchingRows.length <= 15,
      readOnly: true,
      verifiedAt,
      verificationSource: "feedback_desk_items",
    })
  }

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
      status: projects.status,
      jobStatusId: projects.jobStatusId,
      customJobStatusLabel: projectJobStatuses.label,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(
      projectJobStatuses,
      and(
        eq(projectJobStatuses.id, projects.jobStatusId),
        eq(projectJobStatuses.organizationId, projects.organizationId),
      ),
    )
    .where(
      and(
        eq(projects.organizationId, event.organizationId),
        visibleProjectCondition,
      ),
    )
    .orderBy(projects.projectNumber, projects.name)

  const scopedProjects = projectRows.map((project) => {
    const jobStatusLabel = projectJobStatusLabel({
      jobStatusId: project.jobStatusId,
      customLabel: project.customJobStatusLabel,
    })
    return {
      ...project,
      jobStatusLabel,
      statusBucket: projectJobStatusBucket({
        jobStatusId: project.jobStatusId,
        jobStatusLabel,
      }),
    }
  })

  const currentPage = payloadContextValue(payload, "currentPage") ?? ""
  const projectIds = projectIdsForJarvisSearch(
    scopedProjects,
    query,
    currentProjectIdFromPath(currentPage)
  )
  const calendarProjectIds = projectIdsForJarvisCalendarSearch(
    scopedProjects,
    query,
    currentProjectIdFromPath(currentPage),
  )
  const calendarIsProjectScoped = isProjectScopedJarvisCalendarSearch(
    scopedProjects,
    query,
    currentProjectIdFromPath(currentPage),
  )
  const projectSearchIds = projectIdsForJarvisProjectSearch(
    scopedProjects,
    query,
    currentProjectIdFromPath(currentPage),
  )
  const projectById = new Map(
    scopedProjects.map((project) => [project.id, project]),
  )
  const narrowedProjectScope =
    projectIds.length < scopedProjects.length
      ? inArray(projects.id, projectIds)
      : undefined

  if (kindsSet.has("project")) {
    const status = requestedProjectStatus(query)
    const resolvedProjectIds = new Set(projectSearchIds)
    const matchingProjects = scopedProjects.filter(
      (project) =>
        resolvedProjectIds.has(project.id) &&
        (status === null || project.statusBucket === status),
    )
    for (const project of matchingProjects) {
      results.push({
        kind: "project",
        title: project.name,
        summary: cleanSummary(
          project.projectNumber,
          project.clientName,
          project.jobStatusLabel,
        ),
        projectName: project.name,
        projectNumber: project.projectNumber,
        date: project.updatedAt ?? project.createdAt,
        status: project.jobStatusLabel,
        href: projectHref(project.id),
        verified: true,
        lifecycleStage: null,
      })
    }
  }

  if (kindsSet.has("daily_log") && projectIds.length > 0) {
    const rows = await db
      .select({
        id: dailyLogs.id,
        projectId: dailyLogs.projectId,
        logDate: dailyLogs.logDate,
        workCompleted: dailyLogs.workCompleted,
        issues: dailyLogs.issues,
        notes: dailyLogs.notes,
        reviewStatus: dailyLogs.reviewStatus,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(dailyLogs)
      .innerJoin(projects, eq(dailyLogs.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, event.organizationId),
          visibleProjectCondition,
          narrowedProjectScope,
        )
      )
      .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.updatedAt))
      .limit(7)

    sourceComplete = sourceComplete && rows.length <= 6
    for (const row of rows.slice(0, 6)) {
      results.push({
        kind: "daily_log",
        title: `Daily Log · ${row.logDate}`,
        summary: cleanSummary(row.workCompleted, row.issues, row.notes),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.logDate,
        status: row.reviewStatus,
        href: dailyLogHref(row.projectId, row.id),
        verified: false,
        lifecycleStage: null,
      })
    }
  }

  if (kindsSet.has("owner_update") && projectIds.length > 0) {
    const rows = await db
      .select({
        id: ownerProjectUpdates.id,
        projectId: ownerProjectUpdates.projectId,
        title: ownerProjectUpdates.title,
        summary: ownerProjectUpdates.summary,
        updateDate: ownerProjectUpdates.updateDate,
        status: ownerProjectUpdates.status,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(ownerProjectUpdates)
      .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, event.organizationId),
          visibleProjectCondition,
          narrowedProjectScope,
        )
      )
      .orderBy(
        desc(ownerProjectUpdates.updateDate),
        desc(ownerProjectUpdates.updatedAt)
      )
      .limit(7)

    sourceComplete = sourceComplete && rows.length <= 6
    for (const row of rows.slice(0, 6)) {
      results.push({
        kind: "owner_update",
        title: row.title,
        summary: cleanSummary(row.summary),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.updateDate,
        status: row.status,
        href: ownerUpdateHref(row.projectId, row.id),
        verified: false,
        lifecycleStage: null,
      })
    }
  }

  if (kindsSet.has("rfi") && projectIds.length > 0) {
    const rows = await db
      .select({
        id: projectRfis.id,
        projectId: projectRfis.projectId,
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        question: projectRfis.question,
        answer: projectRfis.answer,
        submittedAt: projectRfis.submittedAt,
        status: projectRfis.status,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectRfis)
      .innerJoin(projects, eq(projectRfis.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, event.organizationId),
          visibleProjectCondition,
          narrowedProjectScope,
        )
      )
      .orderBy(desc(projectRfis.submittedAt), desc(projectRfis.updatedAt))
      .limit(7)

    sourceComplete = sourceComplete && rows.length <= 6
    for (const row of rows.slice(0, 6)) {
      results.push({
        kind: "rfi",
        title: `${row.rfiNumber} · ${row.subject}`,
        summary: cleanSummary(row.question, row.answer),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.submittedAt,
        status: row.status,
        href: rfiHref(row.projectId, row.id),
        verified: false,
        lifecycleStage: null,
      })
    }
  }

  if (kindsSet.has("estimate")) {
    const terms = jarvisSearchTerms(query)
    const searchableEstimate = sql`lower(
      coalesce(${projectEstimates.estimateNumber}, '') || ' ' ||
      coalesce(${projectEstimates.title}, '') || ' ' ||
      coalesce(${projectEstimates.clientName}, '') || ' ' ||
      coalesce(${projects.clientName}, '') || ' ' ||
      coalesce(${projects.name}, '') || ' ' ||
      coalesce(${projects.projectNumber}, '')
    )`
    const matchingRows =
      projectIds.length === 0
        ? []
        : await db
            .select({
              id: projectEstimates.id,
              projectId: projectEstimates.projectId,
              estimateNumber: projectEstimates.estimateNumber,
              versionNumber: projectEstimates.versionNumber,
              title: projectEstimates.title,
              status: projectEstimates.status,
              estimateDate: projectEstimates.estimateDate,
              clientName: projectEstimates.clientName,
              totalCents: projectEstimates.estimateTotalCents,
              updatedAt: projectEstimates.updatedAt,
              projectName: projects.name,
              projectNumber: projects.projectNumber,
              projectClientName: projects.clientName,
            })
            .from(projectEstimates)
            .innerJoin(projects, eq(projectEstimates.projectId, projects.id))
            .where(
              and(
                eq(projects.organizationId, event.organizationId),
                visibleProjectCondition,
                narrowedProjectScope,
                ...terms.map(
                  (term) => sql`${searchableEstimate} like ${`%${term}%`}`,
                ),
              ),
            )
            .orderBy(desc(projectEstimates.updatedAt))
            .limit(21)

    sourceComplete = sourceComplete && matchingRows.length <= 20
    for (const row of matchingRows.slice(0, 20)) {
      results.push({
        kind: "estimate",
        title: `${row.estimateNumber} · ${row.title}`,
        summary: cleanSummary(
          `Version ${row.versionNumber}`,
          row.status,
          row.clientName ?? row.projectClientName,
          `$${(row.totalCents / 100).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
        ),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.estimateDate ?? row.updatedAt,
        status: row.status,
        href: estimateHref(row.projectId, row.id),
        verified: true,
        lifecycleStage: null,
      })
    }
  }

  if (kindsSet.has("calendar_event")) {
    const userId = payloadUserId(payload)
    const timeZone = payloadContextValue(payload, "timezone") ?? "UTC"
    const targetDate = requestedCalendarDate(query, timeZone)
    if (userId && targetDate) {
      const calendarSearch = await searchJarvisCalendar({
        db,
        organizationId: event.organizationId,
        userId,
        timeZone,
        targetDate,
        projectById,
        requestedProjectIds: new Set(calendarProjectIds),
        includeUnscopedEvents: !calendarIsProjectScoped,
      })
      results.push(...calendarSearch.results)
      sourceComplete = sourceComplete && calendarSearch.complete
    } else if (!targetDate) {
      sourceComplete = false
    }
  }

  const origin = new URL(request.url).origin
  const projectListOnly = kinds.length === 1 && kinds[0] === "project"
  const calendarOnly = kinds.length === 1 && kinds[0] === "calendar_event"
  const resultLimit = projectListOnly ? 50 : calendarOnly ? 30 : 20
  const ordered = projectListOnly
    ? results
    : results.sort((left, right) =>
        calendarOnly
          ? left.date.localeCompare(right.date)
          : right.date.localeCompare(left.date),
      )
  const sorted = ordered
    .slice(0, resultLimit)
    .map((result) => absoluteResult(origin, result))

  return Response.json({
    query,
    scope: {
      projectIds:
        projectIds.length === scopedProjects.length
          ? "all_visible"
          : projectIds,
      projectSearchIds:
        projectSearchIds.length === scopedProjects.length
          ? "all_visible"
          : projectSearchIds,
      calendarProjectIds:
        calendarProjectIds.length === scopedProjects.length
          ? "all_visible"
          : calendarProjectIds,
      calendarIsProjectScoped,
      kinds,
      deniedKinds,
    },
    results: sorted,
    count: sorted.length,
    complete:
      deniedKinds.length === 0 &&
      sourceComplete &&
      results.length <= resultLimit,
    readOnly: true,
  })
}
