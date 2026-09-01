import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  organizations,
  projectExternalLinks,
  projectOperations,
  projects,
} from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import {
  projectDepartmentFromDivisionLabel,
  resolvedProjectDepartment,
} from "@/lib/project-branding"

type HandoffAction = "create_project" | "update_project"

type HandoffPayload = {
  readonly action: HandoffAction
  readonly source: "hps_project_manager"
  readonly division: string
  readonly projectNumber: string
  readonly name: string
  readonly clientName: string | null
  readonly address: string | null
  readonly status: string | null
  readonly folderId: string | null
  readonly folderLink: string | null
  readonly folderName: string | null
  readonly assignedTo: string | null
  readonly trackerId: string | null
  readonly trackerRowIndex: number | null
  readonly handoffId: string | null
  readonly occurredAt: string | null
  readonly rawPayload: Record<string, unknown>
}

type ParseResult =
  | { readonly success: true; readonly payload: HandoffPayload }
  | { readonly success: false; readonly error: string }

type StringRecord = Record<string, unknown>

const PROJECT_STATUS_VALUES = [
  "OPEN",
  "WARRANTY",
  "COMPLETE",
  "INACTIVE",
  "ARCHIVE",
  "OTHER",
] as const

function envValue(env: CloudflareEnv, key: string): string | null {
  const envRecord = env as unknown as Record<string, unknown>
  const value = envRecord[key] ?? process.env[key]
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

function firstTextValue(
  record: StringRecord,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = textValue(record, key)
    if (value !== null) return value
  }
  return null
}

function composeAddress(value: StringRecord): string | null {
  const directAddress = firstTextValue(value, [
    "address",
    "Address",
    "projectAddress",
    "Project Address",
    "jobsiteAddress",
    "jobSiteAddress",
    "siteAddress",
    "Site Address",
  ])
  const streetNumber = firstTextValue(value, [
    "streetNum",
    "streetNumber",
    "projectStreetNumber",
    "siteStreetNumber",
    "PROJECT STREET NUMBER",
    "Project Street Number",
  ])
  const streetName = firstTextValue(value, [
    "streetName",
    "projectStreetName",
    "siteStreetName",
    "PROJECT STREET NAME",
    "Project Street Name",
  ])
  const street = firstTextValue(value, [
    "streetAddress",
    "addressLine1",
    "siteStreet",
    "projectStreet",
  ])
  const addressLine2 = firstTextValue(value, [
    "addressLine2",
    "siteAddressLine2",
    "projectAddressLine2",
  ])
  const cityState = firstTextValue(value, [
    "cityState",
    "cityStateZip",
    "cityStatePostal",
    "projectCityState",
    "siteCityState",
    "City, State Zip",
    "CITY, STATE ZIP",
  ])
  const city = firstTextValue(value, ["city", "siteCity", "projectCity"])
  const state = firstTextValue(value, ["state", "siteState", "projectState"])
  const zip = firstTextValue(value, [
    "zip",
    "zipcode",
    "zipCode",
    "postalCode",
    "siteZip",
    "projectZip",
    "jobZip",
    "jobsiteZip",
    "projectZipCode",
    "siteZipCode",
    "jobZipCode",
    "jobsiteZipCode",
    "ZIP",
    "Zip",
    "ZIP CODE",
    "Zip Code",
  ])
  const streetFromParts = [streetNumber, streetName]
    .filter((part): part is string => part !== null)
    .join(" ")
  const streetLine = [
    street ?? (streetFromParts.length > 0 ? streetFromParts : directAddress),
    addressLine2,
  ]
    .filter((part): part is string => part !== null)
    .join(", ")
  const stateZip = [state, zip]
    .filter((part): part is string => part !== null)
    .join(" ")
  const cityLine = [city ?? cityState, stateZip.length > 0 ? stateZip : null]
    .filter((part): part is string => part !== null)
    .join(", ")
  const composed = [streetLine, cityLine]
    .filter((part) => part.length > 0)
    .join(", ")

  return composed.length > 0 ? composed : directAddress
}

function numberValue(record: StringRecord, key: string): number | null {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanProjectNumber(value: string): string {
  const trimmed = value.trim()
  const first = trimmed.slice(0, 1).toUpperCase()
  if (first === "0") return `O${trimmed.slice(1)}`
  return `${first}${trimmed.slice(1)}`
}

function normalizeProjectStatus(value: string | null): string {
  if (!value) return "OPEN"
  const upper = value.trim().toUpperCase()
  if (upper === "ACTIVE" || upper.includes("INTAKE")) return "OPEN"
  if (upper.includes("WARRANTY")) return "WARRANTY"
  if (upper.includes("COMPLETE")) return "COMPLETE"
  if (upper.includes("INACTIVE")) return "INACTIVE"
  if (upper.includes("ARCHIVE")) return "ARCHIVE"
  return PROJECT_STATUS_VALUES.some((status) => status === upper)
    ? upper
    : "OTHER"
}

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
}

function driveFolderUrl(folderId: string | null, fallback: string | null): string | null {
  if (fallback) return fallback
  return folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : null
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function isRecord(value: unknown): value is StringRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePayload(value: unknown): ParseResult {
  if (!isRecord(value)) return { success: false, error: "Invalid JSON body" }

  const source = textValue(value, "source")
  if (source !== "hps_project_manager") {
    return { success: false, error: "Unsupported handoff source" }
  }

  const rawAction = textValue(value, "action")
  const action: HandoffAction =
    rawAction === "update_project" ? "update_project" : "create_project"
  const projectNumber = cleanProjectNumber(
    textValue(value, "projectNumber") ?? textValue(value, "projectId") ?? ""
  )
  if (!projectNumber) {
    return { success: false, error: "projectNumber is required" }
  }

  const name =
    textValue(value, "name") ??
    textValue(value, "folderName") ??
    textValue(value, "clientName") ??
    projectNumber

  return {
    success: true,
    payload: {
      action,
      source: "hps_project_manager",
      division: textValue(value, "division") ?? "Unassigned",
      projectNumber,
      name,
      clientName: textValue(value, "clientName"),
      address: composeAddress(value),
      status: textValue(value, "status"),
      folderId: textValue(value, "folderId"),
      folderLink: textValue(value, "folderLink"),
      folderName: textValue(value, "folderName"),
      assignedTo: textValue(value, "assignedTo"),
      trackerId: textValue(value, "trackerId"),
      trackerRowIndex: numberValue(value, "trackerRowIndex"),
      handoffId: textValue(value, "handoffId"),
      occurredAt: textValue(value, "occurredAt"),
      rawPayload: value,
    },
  }
}

async function organizationIdForHandoff(
  db: ReturnType<typeof getDb>,
  env: CloudflareEnv
): Promise<string | null> {
  const configured = envValue(env, "GOOGLE_PROJECT_MANAGER_HANDOFF_ORG_ID")
  if (configured) return configured

  const [firstOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1)

  return firstOrg?.id ?? null
}

async function upsertProjectExternalLink(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly system: string
    readonly label: string
    readonly externalId: string | null
    readonly externalNumber: string | null
    readonly externalUrl: string | null
    readonly syncDirection: string
    readonly syncStatus: string
    readonly metadata: string | null
    readonly now: string
  }
): Promise<void> {
  const [existing] = await db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, input.system)
      )
    )
    .limit(1)

  const values = {
    label: input.label,
    externalId: input.externalId,
    externalNumber: input.externalNumber,
    externalUrl: input.externalUrl,
    syncDirection: input.syncDirection,
    syncStatus: input.syncStatus,
    metadata: input.metadata,
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
    system: input.system,
    createdAt: input.now,
    ...values,
  })
}

async function stageProjectForSageSync(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly payload: HandoffPayload
    readonly now: string
  }
): Promise<void> {
  const [existing] = await db
    .select({ id: projectOperations.id })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        eq(projectOperations.sourceRecordType, "sage_project_handoff"),
        eq(projectOperations.sourceRecordId, input.payload.projectNumber)
      )
    )
    .limit(1)

  const title = `${input.payload.projectNumber} Sage project handoff`
  const description =
    input.payload.action === "create_project"
      ? "Create or match this Google Project Manager project in Sage."
      : "Review Google Project Manager changes and update the Sage job if needed."
  const folderId =
    input.payload.folderId ?? driveFolderIdFromUrl(input.payload.folderLink)
  const values = {
    sourceSystem: "google_project_manager",
    sourceRecordType: "sage_project_handoff",
    sourceRecordId: input.payload.projectNumber,
    sourceRecordNumber: input.payload.projectNumber,
    title,
    description,
    status: "needs_review",
    priority: "high",
    assigneeType: "internal",
    assigneeName: input.payload.assignedTo,
    companyName: input.payload.clientName,
    externalUrl: driveFolderUrl(folderId, input.payload.folderLink),
    sageJobId: null,
    sageJobNumber: null,
    sageWriteStatus: "needs_review",
    sagePayloadJson: JSON.stringify(input.payload.rawPayload),
    syncDirection: "write",
    syncStatus: "pending_sage",
    updatedAt: input.now,
  }

  if (existing) {
    await db
      .update(projectOperations)
      .set(values)
      .where(eq(projectOperations.id, existing.id))
    return
  }

  await db.insert(projectOperations).values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    amount: null,
    costCode: null,
    startDate: null,
    dueDate: null,
    lastSyncedAt: null,
    createdAt: input.now,
    ...values,
  })
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const expectedToken = envValue(env, "GOOGLE_PROJECT_MANAGER_HANDOFF_TOKEN")
  if (!expectedToken) {
    return Response.json(
      { error: "Google Project Manager handoff token is not configured" },
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
      { error: "No organization is available for project handoff" },
      { status: 422 }
    )
  }

  const now = new Date().toISOString()
  const payload = parsed.payload
  const [existingProject] = await db
    .select({ id: projects.id, department: projects.department })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(projects.projectNumber, payload.projectNumber)
      )
    )
    .limit(1)

  const folderId = payload.folderId ?? driveFolderIdFromUrl(payload.folderLink)
  const folderUrl = driveFolderUrl(folderId, payload.folderLink)
  const projectStatus = normalizeProjectStatus(payload.status)
  const department =
    projectDepartmentFromDivisionLabel(payload.division) ??
    resolvedProjectDepartment({ projectNumber: payload.projectNumber })
  const projectId =
    existingProject?.id ??
    `proj-${slugPart(payload.projectNumber)}-${crypto.randomUUID().slice(0, 8)}`

  if (existingProject) {
    const projectUpdates = {
      name: payload.name,
      department: existingProject.department ?? department,
      status: projectStatus,
      clientName: payload.clientName,
      projectManager: payload.assignedTo,
      googleDriveFolderId: folderId,
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      updatedAt: now,
      ...(payload.address === null ? {} : { address: payload.address }),
    }

    await db
      .update(projects)
      .set(projectUpdates)
      .where(eq(projects.id, existingProject.id))
  } else {
    await db.insert(projects).values({
      id: projectId,
      organizationId,
      projectNumber: payload.projectNumber,
      department,
      name: payload.name,
      status: projectStatus,
      address: payload.address,
      clientName: payload.clientName,
      projectManager: payload.assignedTo,
      googleDriveFolderId: folderId,
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      createdAt: now,
      updatedAt: now,
    })
  }

  await upsertProjectExternalLink(db, {
    projectId,
    system: "google_project_manager",
    label: "HPS Project Manager handoff",
    externalId: payload.handoffId,
    externalNumber: payload.projectNumber,
    externalUrl: null,
    syncDirection: "inbound",
    syncStatus: "mapped",
    metadata: JSON.stringify({
      division: payload.division,
      action: payload.action,
      trackerId: payload.trackerId,
      trackerRowIndex: payload.trackerRowIndex,
      occurredAt: payload.occurredAt,
    }),
    now,
  })

  await upsertProjectExternalLink(db, {
    projectId,
    system: "google_drive",
    label: "Project Drive folder",
    externalId: folderId,
    externalNumber: null,
    externalUrl: folderUrl,
    syncDirection: "read_write",
    syncStatus: folderId ? "mapped" : "unmapped",
    metadata: payload.folderName
      ? JSON.stringify({ folderName: payload.folderName })
      : null,
    now,
  })

  await upsertProjectExternalLink(db, {
    projectId,
    system: "sage",
    label: "Sage job",
    externalId: null,
    externalNumber: null,
    externalUrl: null,
    syncDirection: "bidirectional",
    syncStatus: "unmapped",
    metadata: JSON.stringify({
      pendingProjectNumber: payload.projectNumber,
      source: "google_project_manager",
    }),
    now,
  })

  await stageProjectForSageSync(db, { projectId, payload, now })

  return Response.json({
    success: true,
    projectId,
    projectNumber: payload.projectNumber,
    action: existingProject ? "updated" : "created",
    sageSync: "pending_sage",
  })
}
