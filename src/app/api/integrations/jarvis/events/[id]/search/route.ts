import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogs,
  ownerProjectUpdates,
  projectRfis,
  projects,
} from "@/db/schema"
import { jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  canSearchCompassRole,
  currentProjectIdFromPath,
  dailyLogHref,
  ownerUpdateHref,
  projectHref,
  projectIdsForJarvisSearch,
  rfiHref,
  requestedJarvisSearchKinds,
  type JarvisCompassSearchKind,
} from "@/lib/jarvis/search"

type SearchResult = {
  readonly kind: JarvisCompassSearchKind
  readonly title: string
  readonly summary: string
  readonly projectName: string
  readonly projectNumber: string | null
  readonly date: string
  readonly status: string | null
  readonly href: string
}

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

function latestUserMessage(payload: Record<string, unknown>): string {
  const messages = payload.messages
  if (!Array.isArray(messages)) return ""

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== "user") continue
    const content = recordString(message, "content")?.trim() ?? ""
    if (content.length > 0) return content.slice(0, 2_000)
  }
  return ""
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
  result: SearchResult
): SearchResult & { readonly url: string } {
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
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 }
    )
  }

  const verification = await verifyJarvisRequest(request, secret, "")
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

  const query = latestUserMessage(payload)
  if (query.length === 0) {
    return Response.json({ query: "", results: [], count: 0 })
  }

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(eq(projects.organizationId, event.organizationId))
    .orderBy(projects.projectNumber, projects.name)

  const currentPage = payloadContextValue(payload, "currentPage") ?? ""
  const projectIds = projectIdsForJarvisSearch(
    projectRows,
    query,
    currentProjectIdFromPath(currentPage)
  )
  if (projectIds.length === 0) {
    return Response.json({ query, results: [], count: 0 })
  }

  const kinds = requestedJarvisSearchKinds(query)
  const kindsSet = new Set(kinds)
  const results: SearchResult[] = []
  const projectById = new Map(projectRows.map((project) => [project.id, project]))

  for (const projectId of projectIds.slice(0, 3)) {
    const project = projectById.get(projectId)
    if (!project) continue
    results.push({
      kind: "project",
      title: project.name,
      summary: project.projectNumber ?? "Compass project",
      projectName: project.name,
      projectNumber: project.projectNumber,
      date: "",
      status: null,
      href: projectHref(project.id),
    })
  }

  if (kindsSet.has("daily_log")) {
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
          inArray(dailyLogs.projectId, projectIds)
        )
      )
      .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.updatedAt))
      .limit(6)

    for (const row of rows) {
      results.push({
        kind: "daily_log",
        title: `Daily Log · ${row.logDate}`,
        summary: cleanSummary(row.workCompleted, row.issues, row.notes),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.logDate,
        status: row.reviewStatus,
        href: dailyLogHref(row.projectId, row.id),
      })
    }
  }

  if (kindsSet.has("owner_update")) {
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
          inArray(ownerProjectUpdates.projectId, projectIds)
        )
      )
      .orderBy(
        desc(ownerProjectUpdates.updateDate),
        desc(ownerProjectUpdates.updatedAt)
      )
      .limit(6)

    for (const row of rows) {
      results.push({
        kind: "owner_update",
        title: row.title,
        summary: cleanSummary(row.summary),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.updateDate,
        status: row.status,
        href: ownerUpdateHref(row.projectId, row.id),
      })
    }
  }

  if (kindsSet.has("rfi")) {
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
          inArray(projectRfis.projectId, projectIds)
        )
      )
      .orderBy(desc(projectRfis.submittedAt), desc(projectRfis.updatedAt))
      .limit(6)

    for (const row of rows) {
      results.push({
        kind: "rfi",
        title: `${row.rfiNumber} · ${row.subject}`,
        summary: cleanSummary(row.question, row.answer),
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        date: row.submittedAt,
        status: row.status,
        href: rfiHref(row.projectId, row.id),
      })
    }
  }

  const origin = new URL(request.url).origin
  const sorted = results
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 15)
    .map((result) => absoluteResult(origin, result))

  return Response.json({
    query,
    scope: {
      projectIds,
      kinds,
    },
    results: sorted,
    count: sorted.length,
    readOnly: true,
  })
}
