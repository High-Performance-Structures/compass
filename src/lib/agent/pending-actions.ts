import "server-only"

import { and, eq } from "drizzle-orm"
import { SignJWT, jwtVerify } from "jose"
import type { getDb } from "@/db"
import { projects, scheduleTasks } from "@/db/schema"
import { customDashboards } from "@/db/schema-dashboards"

// Agent tool calls that change shared records or delete something wait for
// the user to press Confirm in the chat. The agent receives a pending action
// instead of the result; only a signed-in click on Confirm carries it out.

const CONFIRMATION_AUDIENCE = "compass-agent-confirmation"
const CONFIRMATION_TTL = "10m"

const ACTIONS_REQUIRING_CONFIRMATION: ReadonlyMap<string, ReadonlySet<string>> =
  new Map([
    ["/api/compass/dashboards", new Set(["delete"])],
    [
      "/api/compass/schedule",
      new Set([
        "createTask",
        "updateTask",
        "deleteTask",
        "createDependency",
        "deleteDependency",
      ]),
    ],
  ])

export interface PendingAction {
  readonly userId: string
  readonly organizationId: string
  readonly path: string
  readonly body: Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(body: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = body[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function requiresConfirmation(
  path: string,
  body: unknown,
): body is Record<string, unknown> {
  const actions = ACTIONS_REQUIRING_CONFIRMATION.get(path)
  if (!actions || !isRecord(body)) return false
  const action = body.action
  return typeof action === "string" && actions.has(action)
}

/**
 * Signs the exact action and data the user will confirm. The claims are
 * deliberately named uid/org (not sub/orgId/role), so this token can never
 * pass validateAgentAuth, and its audience keeps agent tokens out of here.
 */
export async function signPendingAction(
  secret: string,
  action: PendingAction,
): Promise<string> {
  return new SignJWT({
    uid: action.userId,
    org: action.organizationId,
    path: action.path,
    body: action.body,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(CONFIRMATION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(CONFIRMATION_TTL)
    .sign(new TextEncoder().encode(secret))
}

export async function verifyPendingAction(
  secret: string,
  token: string,
): Promise<PendingAction | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      audience: CONFIRMATION_AUDIENCE,
    })
    const { uid, org, path, body } = payload
    if (
      typeof uid !== "string" ||
      typeof org !== "string" ||
      typeof path !== "string" ||
      !isRecord(body) ||
      !requiresConfirmation(path, body)
    ) {
      return null
    }
    return { userId: uid, organizationId: org, path, body }
  } catch {
    return null
  }
}

async function taskLabel(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  taskId: string | undefined,
): Promise<string> {
  if (!taskId) return "a schedule task"
  const row = await db
    .select({ title: scheduleTasks.title, project: projects.name })
    .from(scheduleTasks)
    .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
    .where(and(eq(scheduleTasks.id, taskId), eq(projects.organizationId, organizationId)))
    .get()
  return row ? `"${row.title}" on ${row.project}` : "a schedule task"
}

async function projectLabel(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectId: string | undefined,
): Promise<string> {
  if (!projectId) return "the project"
  const row = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  return row?.name ?? "the project"
}

/** A plain-language description of the pending action for the Confirm card. */
export async function describePendingAction(
  db: ReturnType<typeof getDb>,
  action: PendingAction,
): Promise<string> {
  const { body, organizationId, userId } = action
  switch (body.action) {
    case "delete": {
      const dashboardId = stringField(body, "dashboardId")
      const row = dashboardId
        ? await db
            .select({ name: customDashboards.name })
            .from(customDashboards)
            .where(and(eq(customDashboards.id, dashboardId), eq(customDashboards.userId, userId)))
            .get()
        : undefined
      return `Delete your dashboard${row ? ` "${row.name}"` : ""}.`
    }
    case "createTask": {
      const project = await projectLabel(db, organizationId, stringField(body, "projectId"))
      const title = stringField(body, "title") ?? "a new task"
      const start = stringField(body, "startDate")
      return `Add "${title}" to the ${project} schedule${start ? ` starting ${start}` : ""}.`
    }
    case "updateTask": {
      const task = await taskLabel(db, organizationId, stringField(body, "taskId"))
      const changes = Object.keys(body).filter((key) => key !== "action" && key !== "taskId")
      return `Update ${task}${changes.length > 0 ? ` (${changes.join(", ")})` : ""}.`
    }
    case "deleteTask": {
      const task = await taskLabel(db, organizationId, stringField(body, "taskId"))
      return `Delete ${task} from the schedule.`
    }
    case "createDependency": {
      const before = await taskLabel(db, organizationId, stringField(body, "predecessorId"))
      const after = await taskLabel(db, organizationId, stringField(body, "successorId"))
      return `Make ${after} depend on ${before}.`
    }
    case "deleteDependency":
      return "Remove a dependency between two schedule tasks."
    default:
      return "Make a change in Compass."
  }
}
