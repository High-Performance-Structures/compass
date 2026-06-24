import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  organizations,
  projectExternalLinks,
  projectOperations,
  projects,
} from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"

type ScriptHandoffPayload = {
  readonly source: string
  readonly action: string
  readonly projectNumber: string
  readonly title: string
  readonly description: string | null
  readonly division: string | null
  readonly companyName: string | null
  readonly assigneeName: string | null
  readonly status: string | null
  readonly priority: string
  readonly amount: number | null
  readonly dueDate: string | null
  readonly externalUrl: string | null
  readonly handoffId: string
  readonly occurredAt: string | null
  readonly rawPayload: Record<string, unknown>
}

type ParseResult =
  | { readonly success: true; readonly payload: ScriptHandoffPayload }
  | { readonly success: false; readonly error: string }

type StringRecord = Record<string, unknown>

function envValue(env: CloudflareEnv, key: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(env, key)
  const envValueRaw = descriptor?.value
  const processValue = process.env[key]
  const value =
    typeof envValueRaw === "string" && envValueRaw.trim().length > 0
      ? envValueRaw
      : processValue

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function textValue(record: StringRecord, key: string): string | null {
  const value = record[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberValue(record: StringRecord, key: string): number | null {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const parsed = Number(value.replace(/[$,]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function cleanProjectNumber(value: string): string {
  const trimmed = value.trim()
  const first = trimmed.slice(0, 1).toUpperCase()
  if (first === "0") return `O${trimmed.slice(1)}`
  return `${first}${trimmed.slice(1)}`
}

function isRecord(value: unknown): value is StringRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scriptLabel(source: string): string {
  if (source === "hps_project_intake") return "HPS project intake"
  if (source === "nutech_po_order_manager") return "Nu-Tech PO order"
  if (source === "finish_schedule_generator") return "Finish schedule"
  return "Google script"
}

function recordTypeForSource(source: string): string {
  if (source === "hps_project_intake") return "google_project_intake"
  if (source === "nutech_po_order_manager") return "google_nutech_order"
  if (source === "finish_schedule_generator") return "google_finish_schedule"
  return "google_script_handoff"
}

function writeStatusForSource(source: string): string {
  if (source === "nutech_po_order_manager") return "needs_review"
  if (source === "hps_project_intake") return "needs_review"
  return "not_ready"
}

function syncStatusForSource(source: string): string {
  if (source === "nutech_po_order_manager") return "pending_sage"
  if (source === "hps_project_intake") return "pending_sage"
  return "needs_review"
}

function parsePayload(value: unknown): ParseResult {
  if (!isRecord(value)) return { success: false, error: "Invalid JSON body" }

  const source = textValue(value, "source") ?? "google_apps_script"
  const projectNumber = cleanProjectNumber(
    textValue(value, "projectNumber") ?? textValue(value, "projectId") ?? ""
  )
  if (!projectNumber) {
    return { success: false, error: "projectNumber is required" }
  }

  const action = textValue(value, "action") ?? "script_handoff"
  const title =
    textValue(value, "title") ??
    textValue(value, "name") ??
    `${projectNumber} ${scriptLabel(source)} handoff`
  const handoffId =
    textValue(value, "handoffId") ??
    textValue(value, "recordId") ??
    `${source}:${projectNumber}:${action}:${title}`

  return {
    success: true,
    payload: {
      source,
      action,
      projectNumber,
      title,
      description: textValue(value, "description"),
      division: textValue(value, "division"),
      companyName: textValue(value, "companyName"),
      assigneeName:
        textValue(value, "assigneeName") ?? textValue(value, "assignedTo"),
      status: textValue(value, "status"),
      priority: textValue(value, "priority") ?? "normal",
      amount: numberValue(value, "amount"),
      dueDate: textValue(value, "dueDate") ?? textValue(value, "requiredDate"),
      externalUrl:
        textValue(value, "externalUrl") ?? textValue(value, "folderLink"),
      handoffId,
      occurredAt: textValue(value, "occurredAt"),
      rawPayload: value,
    },
  }
}

async function organizationIdForHandoff(
  db: ReturnType<typeof getDb>,
  env: CloudflareEnv
): Promise<string | null> {
  const configured = envValue(env, "GOOGLE_SCRIPT_HANDOFF_ORG_ID")
  if (configured) return configured

  const [firstOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1)

  return firstOrg?.id ?? null
}

async function upsertSourceLink(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly payload: ScriptHandoffPayload
    readonly now: string
  }
): Promise<void> {
  const system = `google_${input.payload.source}`.slice(0, 120)
  const [existing] = await db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, system)
      )
    )
    .limit(1)

  const values = {
    label: scriptLabel(input.payload.source),
    externalId: input.payload.handoffId,
    externalNumber: input.payload.projectNumber,
    externalUrl: input.payload.externalUrl,
    syncDirection: "inbound",
    syncStatus: "needs_review",
    metadata: JSON.stringify({
      action: input.payload.action,
      division: input.payload.division,
      occurredAt: input.payload.occurredAt,
    }),
    updatedAt: input.now,
  }

  if (existing) {
    await db
      .update(projectExternalLinks)
      .set(values)
      .where(eq(projectExternalLinks.id, existing.id))
    return
  }

  await db.insert(projectExternalLinks).values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    system,
    createdAt: input.now,
    ...values,
  })
}

async function upsertScriptOperation(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly payload: ScriptHandoffPayload
    readonly now: string
  }
): Promise<string> {
  const recordType = recordTypeForSource(input.payload.source)
  const [existing] = await db
    .select({ id: projectOperations.id })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        eq(projectOperations.sourceRecordType, recordType),
        eq(projectOperations.sourceRecordId, input.payload.handoffId)
      )
    )
    .limit(1)

  const values = {
    sourceSystem: input.payload.source,
    sourceRecordType: recordType,
    sourceRecordId: input.payload.handoffId,
    sourceRecordNumber: input.payload.projectNumber,
    title: input.payload.title,
    description:
      input.payload.description ??
      `${scriptLabel(input.payload.source)} handoff from Google Workspace.`,
    status: input.payload.status ?? "needs_review",
    priority: input.payload.priority,
    assigneeType: input.payload.assigneeName ? "internal" : null,
    assigneeName: input.payload.assigneeName,
    companyName: input.payload.companyName,
    dueDate: input.payload.dueDate,
    amount: input.payload.amount,
    externalUrl: input.payload.externalUrl,
    sageWriteStatus: writeStatusForSource(input.payload.source),
    sagePayloadJson: JSON.stringify(input.payload.rawPayload),
    syncDirection: "write",
    syncStatus: syncStatusForSource(input.payload.source),
    updatedAt: input.now,
  }

  if (existing) {
    await db
      .update(projectOperations)
      .set(values)
      .where(eq(projectOperations.id, existing.id))
    return existing.id
  }

  const id = crypto.randomUUID()
  await db.insert(projectOperations).values({
    id,
    projectId: input.projectId,
    costCode: null,
    startDate: null,
    lastSyncedAt: null,
    createdAt: input.now,
    ...values,
  })
  return id
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const expectedToken =
    envValue(env, "GOOGLE_SCRIPT_HANDOFF_TOKEN") ??
    envValue(env, "GOOGLE_PROJECT_MANAGER_HANDOFF_TOKEN")
  if (!expectedToken) {
    return Response.json(
      { error: "Google script handoff token is not configured" },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get("authorization")
  const submittedToken =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (submittedToken !== expectedToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = parsePayload(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  const db = getDb(env.DB)
  const organizationId = await organizationIdForHandoff(db, env)
  if (!organizationId) {
    return Response.json(
      { error: "No organization is available for script handoff" },
      { status: 422 }
    )
  }

  const payload = parsed.payload
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(projects.projectNumber, payload.projectNumber)
      )
    )
    .limit(1)

  if (!project) {
    return Response.json(
      {
        error: "Project not found",
        projectNumber: payload.projectNumber,
      },
      { status: 404 }
    )
  }

  const now = new Date().toISOString()
  await upsertSourceLink(db, { projectId: project.id, payload, now })
  const operationId = await upsertScriptOperation(db, {
    projectId: project.id,
    payload,
    now,
  })

  return Response.json({
    success: true,
    projectId: project.id,
    operationId,
    source: payload.source,
    syncStatus: syncStatusForSource(payload.source),
  })
}
