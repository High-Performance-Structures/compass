"use server"

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  customers,
  organizationMembers,
  projectContacts,
  projectExternalLinks,
  projectFollowUps,
  projectInteractions,
  projectJobStatuses,
  projectNotes,
  projectNumberAliases,
  projectNumberReservations,
  projectProfileAuditEvents,
  projectProfileSyncOperations,
  projects,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  canManageProjectRegistry,
} from "@/lib/permissions"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { buildProjectDriveFolderName } from "@/lib/google/project-drive-provisioning"
import {
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  patchProjectTrackerCells,
  PROJECT_REGISTRY_DESTINATION,
  updateProjectTrackerRow,
  type ProjectIntakeDepartment,
} from "@/lib/google/project-intake-tracker"
import { resolveProjectIntakeIntegrationEmail } from "@/lib/google/project-intake-identity"
import {
  PROJECT_CLIENT_STATUSES,
  PROJECT_JOB_STATUS_DEFINITIONS,
  buildProjectNumberWithAddressSuffix,
  isEligibleFollowUpOwner,
  isMeaningfulClientInteraction,
  projectNumberParts,
  type ProjectClientStatus,
} from "@/lib/project-profile"
import { clientFollowUpState } from "@/lib/project-follow-up"
import { getProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectProfileResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type ProjectProfileJobStatus = {
  readonly id: string
  readonly label: string
  readonly sageCode: string | null
  readonly followUpCadenceDays: number | null
  readonly active: boolean
  readonly builtIn: boolean
}

export type ProjectProfileNote = {
  readonly id: string
  readonly body: string
  readonly authorName: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type ProjectProfileInteraction = {
  readonly id: string
  readonly interactionType: string
  readonly direction: string
  readonly summary: string
  readonly source: string
  readonly occurredAt: string
  readonly authorName: string | null
  readonly contactId: string | null
}

export type ProjectFollowUpOwner = {
  readonly id: string
  readonly displayName: string
}

export type ProjectInformation = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly projectAddress: string | null
    readonly mailingAddress: string | null
    readonly clientStatus: ProjectClientStatus
    readonly jobStatusId: string
    readonly status: string
  }
  readonly jobStatuses: readonly ProjectProfileJobStatus[]
  readonly clientContacts: readonly {
    readonly id: string
    readonly displayName: string
  }[]
  readonly projectNumberAliases: readonly string[]
  readonly notes: readonly ProjectProfileNote[]
  readonly interactions: readonly ProjectProfileInteraction[]
  readonly followUp: {
    readonly nextFollowUpAt: string
    readonly ownerUserId: string | null
    readonly ownerName: string | null
  } | null
  readonly syncOperations: readonly {
    readonly id: string
    readonly operation: string
    readonly status: string
    readonly error: string | null
    readonly updatedAt: string
  }[]
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function isProjectClientStatus(value: string): value is ProjectClientStatus {
  return value === "lead" || value === "customer"
}

function nowIso(): string {
  return new Date().toISOString()
}

function profilePath(projectId: string): string {
  return `/dashboard/projects/${projectId}`
}

function revalidateProjectProfile(projectId: string): void {
  revalidatePath(profilePath(projectId))
  revalidatePath(`${profilePath(projectId)}/information`)
  revalidatePath("/dashboard/projects")
  revalidatePath("/dashboard/projects/follow-up")
}

function trackerDepartment(projectNumber: string | null): ProjectIntakeDepartment | null {
  const prefix = projectNumber?.trim().slice(0, 1).toUpperCase()
  if (prefix === "O" || prefix === "H" || prefix === "N" || prefix === "D") {
    return prefix
  }
  return null
}

function projectAddressParts(address: string | null): {
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
} {
  const parts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  const street = parts[0] ?? ""
  const match = /^(\S+)\s+(.+)$/.exec(street)
  return {
    streetNumber: match?.[1] ?? null,
    streetName: match?.[2] ?? (street || null),
    cityStateZip: parts.slice(1).join(", ") || null,
  }
}

function syncProjectNumbers(payloadJson: string): {
  readonly previousProjectNumber: string
  readonly projectNumber: string
} | null {
  try {
    const payload: unknown = JSON.parse(payloadJson)
    if (
      typeof payload === "object"
      && payload !== null
      && "previousProjectNumber" in payload
      && "projectNumber" in payload
      && typeof payload.previousProjectNumber === "string"
      && typeof payload.projectNumber === "string"
    ) {
      return {
        previousProjectNumber: payload.previousProjectNumber,
        projectNumber: payload.projectNumber,
      }
    }
  } catch {
    return null
  }
  return null
}

async function projectSyncClients(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly environment: Awaited<ReturnType<typeof getCloudflareContext>>["env"]
}): Promise<{ readonly drive: DriveClient; readonly sheets: SheetsClient; readonly trackerEmail: string }> {
  if (!input.environment?.DB) throw new Error("Database unavailable")
  const authRows = await input.db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
      connectorGoogleEmail: users.googleEmail,
      connectorEmail: users.email,
    })
    .from(googleAuth)
    .innerJoin(users, eq(users.id, googleAuth.connectedBy))
    .where(eq(googleAuth.organizationId, input.organizationId))
    .limit(1)
  const auth = authRows[0]
  if (!auth) throw new Error("Google Workspace service account is not connected.")
  const config = getGoogleConfig(input.environment)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt(),
  )
  const serviceAccountKey = parseServiceAccountKey(keyJson)
  return {
    drive: new DriveClient({ serviceAccountKey }),
    sheets: new SheetsClient(serviceAccountKey),
    trackerEmail: resolveProjectIntakeIntegrationEmail({
      connectorGoogleEmail: auth.connectorGoogleEmail,
      connectorEmail: auth.connectorEmail,
    }),
  }
}

async function projectProfileContext(projectId: string, action: "read" | "update") {
  const user = await requireAuth()
  requireFeaturePermission(user, "project-hub", action)
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Project information is available to internal staff only.")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("Database unavailable")
  const db = getDb(env.DB)
  const access = await getProjectAccessRecord(db, user, projectId)
  if (!access || access.organizationId !== organizationId) {
    throw new Error("Project not found or access denied.")
  }
  return { db, organizationId, user }
}

async function writeAuditEvent(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly actorId: string
  readonly eventType: string
  readonly entityType: string
  readonly entityId: string | null
  readonly before: unknown
  readonly after: unknown
}): Promise<void> {
  await input.db.insert(projectProfileAuditEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    actorUserId: input.actorId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: JSON.stringify(input.before),
    afterJson: JSON.stringify(input.after),
    createdAt: nowIso(),
  })
}

async function validJobStatus(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly jobStatusId: string
}): Promise<boolean> {
  if (PROJECT_JOB_STATUS_DEFINITIONS.some((status) => status.id === input.jobStatusId)) {
    return true
  }
  const custom = await input.db
    .select({ id: projectJobStatuses.id })
    .from(projectJobStatuses)
    .where(
      and(
        eq(projectJobStatuses.organizationId, input.organizationId),
        eq(projectJobStatuses.id, input.jobStatusId),
        eq(projectJobStatuses.active, true),
      ),
    )
    .limit(1)
  return custom.length === 1
}

function jobStatusOptions(
  custom: readonly {
    readonly id: string
    readonly label: string
    readonly sageCode: string | null
    readonly followUpCadenceDays: number | null
    readonly active: boolean
  }[],
): readonly ProjectProfileJobStatus[] {
  return [
    ...PROJECT_JOB_STATUS_DEFINITIONS.map((status) => ({
      id: status.id,
      label: status.label,
      sageCode: null,
      followUpCadenceDays: status.followUpCadenceDays,
      active: true,
      builtIn: true,
    })),
    ...custom.map((status) => ({ ...status, builtIn: false })),
  ]
}

export async function getProjectFollowUpOwners(
  projectId: string,
): Promise<readonly ProjectFollowUpOwner[]> {
  try {
    const { db, organizationId } = await projectProfileContext(projectId, "read")
    const members = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        active: users.isActive,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
      .orderBy(asc(users.displayName), asc(users.email))
    return members
      .filter((member) => isEligibleFollowUpOwner(member))
      .map((member) => ({ id: member.id, displayName: member.displayName ?? member.email }))
  } catch (error) {
    console.error("Unable to load follow-up owners", error)
    return []
  }
}

export async function getProjectInformation(
  projectId: string,
): Promise<ProjectInformation | null> {
  try {
    const { db, organizationId } = await projectProfileContext(projectId, "read")
    const projectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        projectAddress: projects.address,
        mailingAddress: projects.mailingAddress,
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
        status: projects.status,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
    const project = projectRows[0]
    if (!project) return null

    const [customStatuses, notes, interactions, followUps, operations, aliases, clientContacts] = await Promise.all([
      db
        .select({
          id: projectJobStatuses.id,
          label: projectJobStatuses.label,
          sageCode: projectJobStatuses.sageCode,
          followUpCadenceDays: projectJobStatuses.followUpCadenceDays,
          active: projectJobStatuses.active,
        })
        .from(projectJobStatuses)
        .where(
          and(
            eq(projectJobStatuses.organizationId, organizationId),
            eq(projectJobStatuses.active, true),
          ),
        )
        .orderBy(asc(projectJobStatuses.sortOrder), asc(projectJobStatuses.label)),
      db
        .select({
          id: projectNotes.id,
          body: projectNotes.content,
          authorName: users.displayName,
          createdAt: projectNotes.createdAt,
          updatedAt: projectNotes.updatedAt,
        })
        .from(projectNotes)
        .leftJoin(users, eq(users.id, projectNotes.createdBy))
        .where(and(eq(projectNotes.projectId, projectId), isNull(projectNotes.deletedAt)))
        .orderBy(desc(projectNotes.createdAt)),
      db
        .select({
          id: projectInteractions.id,
          interactionType: projectInteractions.interactionType,
          direction: projectInteractions.direction,
          summary: projectInteractions.summary,
          source: projectInteractions.source,
          occurredAt: projectInteractions.occurredAt,
          authorName: users.displayName,
          contactId: projectInteractions.projectContactId,
        })
        .from(projectInteractions)
        .leftJoin(users, eq(users.id, projectInteractions.createdBy))
        .where(
          and(
            eq(projectInteractions.projectId, projectId),
            eq(projectInteractions.qualifiesForClientTouch, true),
            isNull(projectInteractions.deletedAt),
          ),
        )
        .orderBy(desc(projectInteractions.occurredAt)),
      db
        .select({
          nextFollowUpAt: projectFollowUps.nextFollowUpAt,
          ownerUserId: projectFollowUps.ownerUserId,
          ownerName: users.displayName,
        })
        .from(projectFollowUps)
        .leftJoin(
          organizationMembers,
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, projectFollowUps.ownerUserId),
          ),
        )
        .leftJoin(users, and(eq(users.id, organizationMembers.userId), eq(users.isActive, true)))
        .where(eq(projectFollowUps.projectId, projectId))
        .limit(1),
      db
        .select({
          id: projectProfileSyncOperations.id,
          operation: projectProfileSyncOperations.operation,
          status: projectProfileSyncOperations.status,
          error: projectProfileSyncOperations.error,
          updatedAt: projectProfileSyncOperations.updatedAt,
        })
        .from(projectProfileSyncOperations)
        .where(eq(projectProfileSyncOperations.projectId, projectId))
        .orderBy(desc(projectProfileSyncOperations.updatedAt))
        .limit(12),
      db
        .select({ projectNumber: projectNumberAliases.projectNumber })
        .from(projectNumberAliases)
        .where(eq(projectNumberAliases.projectId, projectId))
        .orderBy(desc(projectNumberAliases.createdAt)),
      db
        .select({ id: projectContacts.id, displayName: projectContacts.displayName })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.contactType, "owner"),
            eq(projectContacts.active, true),
          ),
        )
        .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder)),
    ])

    const clientStatus = isProjectClientStatus(project.clientStatus)
      ? project.clientStatus
      : "customer"
    return {
      project: { ...project, clientStatus },
      jobStatuses: jobStatusOptions(customStatuses),
      clientContacts,
      projectNumberAliases: aliases.map((alias) => alias.projectNumber),
      notes,
      interactions,
      followUp: followUps[0] ?? null,
      syncOperations: operations,
    }
  } catch (error) {
    console.error("Unable to load project information", error)
    return null
  }
}

export type ProjectFollowUpQueueItem = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly clientStatus: ProjectClientStatus
  readonly jobStatusId: string
  readonly jobStatusLabel: string
  readonly state: "current" | "due" | "overdue" | "scheduled" | "unrecorded"
  readonly businessDaysSinceLastTouch: number | null
  readonly lastClientInteractionAt: string | null
  readonly nextFollowUpAt: string | null
  readonly followUpOwnerName: string | null
}

export async function getProjectFollowUpQueue(): Promise<
  readonly ProjectFollowUpQueueItem[]
> {
  try {
    const user = await requireAuth()
    requireFeaturePermission(user, "project-hub", "read")
    if (!isInternalStaffRole(user.role)) return []
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const db = getDb(env.DB)
    const [rows, customStatuses] = await Promise.all([
      db
        .select({
          projectId: projects.id,
          projectNumber: projects.projectNumber,
          projectName: projects.name,
          clientName: projects.clientName,
          clientStatus: projects.clientStatus,
          jobStatusId: projects.jobStatusId,
          occurredAt: projectInteractions.occurredAt,
          nextFollowUpAt: projectFollowUps.nextFollowUpAt,
          ownerName: users.displayName,
        })
        .from(projects)
        .leftJoin(projectFollowUps, eq(projectFollowUps.projectId, projects.id))
        .leftJoin(
          organizationMembers,
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, projectFollowUps.ownerUserId),
          ),
        )
        .leftJoin(users, and(eq(users.id, organizationMembers.userId), eq(users.isActive, true)))
        .leftJoin(
          projectInteractions,
          and(
            eq(projectInteractions.projectId, projects.id),
            eq(projectInteractions.qualifiesForClientTouch, true),
            isNull(projectInteractions.deletedAt),
          ),
        )
        .where(eq(projects.organizationId, organizationId))
        .orderBy(desc(projectInteractions.occurredAt)),
      db
        .select({
          id: projectJobStatuses.id,
          label: projectJobStatuses.label,
          cadenceDays: projectJobStatuses.followUpCadenceDays,
        })
        .from(projectJobStatuses)
        .where(
          and(
            eq(projectJobStatuses.organizationId, organizationId),
            eq(projectJobStatuses.active, true),
          ),
        ),
    ])
    const customStatusesById = new Map(customStatuses.map((status) => [status.id, status]))
    const builtInStatusLabels = new Map<string, string>(
      PROJECT_JOB_STATUS_DEFINITIONS.map((status) => [status.id, status.label]),
    )
    const grouped = new Map<
      string,
      {
        readonly projectId: string
        readonly projectNumber: string | null
        readonly projectName: string
        readonly clientName: string | null
        readonly clientStatus: ProjectClientStatus
        readonly jobStatusId: string
        readonly nextFollowUpAt: string | null
        readonly ownerName: string | null
        readonly interactions: {
          readonly occurredAt: string
          readonly deletedAt: null
          readonly qualifiesForClientTouch: true
        }[]
      }
    >()
    for (const row of rows) {
      let project = grouped.get(row.projectId)
      if (!project) {
        const clientStatus = isProjectClientStatus(row.clientStatus)
          ? row.clientStatus
          : "customer"
        project = {
          projectId: row.projectId,
          projectNumber: row.projectNumber,
          projectName: row.projectName,
          clientName: row.clientName,
          clientStatus,
          jobStatusId: row.jobStatusId,
          nextFollowUpAt: row.nextFollowUpAt,
          ownerName: row.ownerName,
          interactions: [],
        }
        grouped.set(row.projectId, project)
      }
      if (row.occurredAt) {
        project.interactions.push({
          occurredAt: row.occurredAt,
          deletedAt: null,
          qualifiesForClientTouch: true,
        })
      }
    }

    const queue = [...grouped.values()].flatMap((project) => {
      const customStatus = customStatusesById.get(project.jobStatusId)
      const state = clientFollowUpState({
        jobStatusId: project.jobStatusId,
        cadenceDays: customStatus ? customStatus.cadenceDays : undefined,
        interactions: project.interactions,
        nextFollowUpAt: project.nextFollowUpAt,
        now: new Date(),
      })
      if (!state.eligible || state.state === "excluded") return []
      const jobStatusLabel =
        builtInStatusLabels.get(project.jobStatusId) ?? customStatus?.label ?? "Unknown"
      return [{
        projectId: project.projectId,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        clientName: project.clientName,
        clientStatus: project.clientStatus,
        jobStatusId: project.jobStatusId,
        jobStatusLabel,
        state: state.state,
        businessDaysSinceLastTouch: state.businessDaysSinceLastTouch,
        lastClientInteractionAt: state.lastClientInteractionAt,
        nextFollowUpAt: state.nextFollowUpAt,
        followUpOwnerName: project.ownerName,
      }]
    })
    const stateOrder: Readonly<Record<ProjectFollowUpQueueItem["state"], number>> = {
      overdue: 0,
      due: 1,
      unrecorded: 2,
      current: 3,
      scheduled: 4,
    }
    return queue.sort((left, right) => {
      const stateDifference = stateOrder[left.state] - stateOrder[right.state]
      if (stateDifference !== 0) return stateDifference
      const leftTime = left.nextFollowUpAt ?? left.lastClientInteractionAt ?? ""
      const rightTime = right.nextFollowUpAt ?? right.lastClientInteractionAt ?? ""
      return leftTime.localeCompare(rightTime)
    })
  } catch (error) {
    console.error("Unable to load project follow-up queue", error)
    return []
  }
}

export async function retryProjectProfileSyncOperation(input: {
  readonly projectId: string
  readonly operationId: string
}): Promise<ProjectProfileResult> {
  const attemptedAt = nowIso()
  try {
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    const operationRows = await db
      .select({
        id: projectProfileSyncOperations.id,
        operation: projectProfileSyncOperations.operation,
        payloadJson: projectProfileSyncOperations.payloadJson,
        attempts: projectProfileSyncOperations.attempts,
      })
      .from(projectProfileSyncOperations)
      .where(
        and(
          eq(projectProfileSyncOperations.id, input.operationId),
          eq(projectProfileSyncOperations.projectId, input.projectId),
          eq(projectProfileSyncOperations.organizationId, organizationId),
        ),
      )
      .limit(1)
    const operation = operationRows[0]
    if (!operation) return { success: false, error: "Synchronization operation not found." }
    const numbers = syncProjectNumbers(operation.payloadJson)
    if (!numbers) return { success: false, error: "Synchronization operation has invalid project-number data." }
    const projectRows = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        address: projects.address,
        mailingAddress: projects.mailingAddress,
        clientName: projects.clientName,
        projectManager: projects.projectManager,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
    const project = projectRows[0]
    if (!project || !project.projectNumber) return { success: false, error: "Project number is unavailable." }
    const clients = await projectSyncClients({ db, organizationId, environment: (await getCloudflareContext()).env })
    const nextAttempts = operation.attempts + 1

    if (operation.operation === "drive_folder_rename") {
      const driveLinks = await db
        .select({ externalId: projectExternalLinks.externalId })
        .from(projectExternalLinks)
        .where(and(eq(projectExternalLinks.projectId, input.projectId), eq(projectExternalLinks.system, "google_drive")))
        .limit(1)
      const folderId = project.googleDriveFolderId ?? driveLinks[0]?.externalId ?? null
      if (!folderId) throw new Error("No Google Drive folder is linked to this project.")
      const address = projectAddressParts(project.address)
      const folderName = buildProjectDriveFolderName({
        projectNumber: project.projectNumber,
        projectName: project.name,
        streetNumber: address.streetNumber,
        streetName: address.streetName,
      })
      await clients.drive.renameFile(user.googleEmail ?? user.email, folderId, folderName)
    } else if (operation.operation === "tracker_row_update") {
      const department = trackerDepartment(project.projectNumber)
      if (!department) throw new Error("Project number has no supported tracker department.")
      const contactRows = await db
        .select({ displayName: projectContacts.displayName, companyName: projectContacts.companyName, email: projectContacts.email, phone: projectContacts.phone })
        .from(projectContacts)
        .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
        .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder))
        .limit(1)
      const contact = contactRows[0]
      const address = projectAddressParts(project.address)
      const clientName = project.clientName ?? contact?.displayName ?? ""
      const nameParts = clientName.trim().split(/\s+/).filter(Boolean)
      const firstName = nameParts[0] ?? ""
      const lastName = nameParts.slice(1).join(" ")
      const driveFolderUrl = project.googleDriveFolderId ? `https://drive.google.com/drive/folders/${project.googleDriveFolderId}` : ""
      const trackerDestination = departmentTrackingDestination(department)
      const registryRows = await clients.sheets.getValues(clients.trackerEmail, { spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId, range: "'Registry'!A:ZZ" })
      const registryLayout = locateProjectTrackerLayout(registryRows)
      if (!registryLayout) throw new Error("Project Registry has no Project Number or Project ID header.")
      const syncProjectNumbers = [numbers.previousProjectNumber, project.projectNumber]
      await updateProjectTrackerRow({
        sheets: clients.sheets,
        googleEmail: clients.trackerEmail,
        spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
        sheetTitle: PROJECT_REGISTRY_DESTINATION.sheetTitle,
        rows: registryRows,
        layout: registryLayout,
        currentProjectNumbers: syncProjectNumbers,
        patches: patchProjectTrackerCells({ layout: registryLayout, values: { "project id": project.projectNumber, "project number": project.projectNumber, "street number code": address.streetNumber ?? "", "street name label": address.streetName ?? project.name, "client first name": firstName, "client last name": lastName, "company name": contact?.companyName ?? "", "city state zip": address.cityStateZip ?? "", "folder link": driveFolderUrl, "lead tracker link": `https://docs.google.com/spreadsheets/d/${trackerDestination.spreadsheetId}` } }),
      })
      const departmentRows = await clients.sheets.getValues(clients.trackerEmail, { spreadsheetId: trackerDestination.spreadsheetId, range: "'Tracker'!A:ZZ" })
      const departmentLayout = locateProjectTrackerLayout(departmentRows)
      if (!departmentLayout) throw new Error(`${trackerDestination.workbookTitle} has no Project Number or Project ID header.`)
      await updateProjectTrackerRow({
        sheets: clients.sheets,
        googleEmail: clients.trackerEmail,
        spreadsheetId: trackerDestination.spreadsheetId,
        sheetTitle: trackerDestination.sheetTitle,
        rows: departmentRows,
        layout: departmentLayout,
        currentProjectNumbers: syncProjectNumbers,
        patches: patchProjectTrackerCells({ layout: departmentLayout, values: { "project id": project.projectNumber, "project number": project.projectNumber, client: clientName, customer: clientName, "builder gc": contact?.companyName ?? clientName, "contact person": clientName, address: project.address ?? "", "project address": project.address ?? "", phone: contact?.phone ?? "", email: contact?.email ?? "", "billing address": project.mailingAddress ?? "", "folder link": driveFolderUrl } }),
      })
    } else {
      return { success: false, error: "Unsupported synchronization operation." }
    }

    await db
      .update(projectProfileSyncOperations)
      .set({ status: "completed", error: null, attempts: nextAttempts, attemptedAt, completedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(projectProfileSyncOperations.id, operation.id))
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "project_profile_sync_completed", entityType: "project_profile_sync_operation", entityId: operation.id, before: null, after: { operation: operation.operation } })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "External synchronization failed."
    try {
      const { db } = await projectProfileContext(input.projectId, "update")
      await db
        .update(projectProfileSyncOperations)
        .set({
          status: "failed",
          error: errorMessage.slice(0, 1000),
          attempts: sql`${projectProfileSyncOperations.attempts} + 1`,
          attemptedAt,
          updatedAt: nowIso(),
        })
        .where(eq(projectProfileSyncOperations.id, input.operationId))
    } catch (updateError) {
      console.error("Unable to record project profile synchronization failure", updateError)
    }
    console.error("Unable to synchronize project profile", error)
    revalidateProjectProfile(input.projectId)
    return { success: false, error: errorMessage }
  }
}

export async function updateProjectInformation(input: {
  readonly projectId: string
  readonly projectAddress: string | null
  readonly mailingAddress: string | null
  readonly clientStatus: ProjectClientStatus
  readonly jobStatusId: string
  readonly addressSuffix: string | null
  readonly updateClientDefaultMailingAddress: boolean
}): Promise<ProjectProfileResult> {
  try {
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (!PROJECT_CLIENT_STATUSES.includes(input.clientStatus)) {
      return { success: false, error: "Choose Lead or Customer." }
    }
    if (!(await validJobStatus({ db, organizationId, jobStatusId: input.jobStatusId }))) {
      return { success: false, error: "Choose an active governed job status." }
    }

    const existingRows = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        address: projects.address,
        mailingAddress: projects.mailingAddress,
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
      })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
    const existing = existingRows[0]
    if (!existing) return { success: false, error: "Project not found." }

    const projectAddress = nullableText(input.projectAddress)
    const mailingAddress = nullableText(input.mailingAddress)
    let projectNumber = existing.projectNumber
    if (input.addressSuffix !== null && existing.projectNumber) {
      try {
        projectNumber = buildProjectNumberWithAddressSuffix(
          existing.projectNumber,
          input.addressSuffix,
        )
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Invalid project-number suffix.",
        }
      }
    }

    const numberChanged = projectNumber !== existing.projectNumber && projectNumber !== null
    if (numberChanged) {
      const requestedProjectNumber = projectNumber
      if (!requestedProjectNumber) return { success: false, error: "Project number is unavailable." }
      const [projectConflict, aliasConflict] = await Promise.all([
        db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, organizationId),
              eq(projects.projectNumber, requestedProjectNumber),
            ),
          )
          .limit(1),
        db
          .select({ projectId: projectNumberAliases.projectId })
          .from(projectNumberAliases)
          .where(
            and(
              eq(projectNumberAliases.organizationId, organizationId),
              eq(projectNumberAliases.projectNumber, requestedProjectNumber),
            ),
          )
          .limit(1),
      ])
      if (projectConflict[0] && projectConflict[0].id !== existing.id) {
        return { success: false, error: "That project number already exists." }
      }
      if (aliasConflict[0] && aliasConflict[0].projectId !== existing.id) {
        return { success: false, error: "That project number is reserved by a historical project record." }
      }
    }

    const linkedCustomers = input.updateClientDefaultMailingAddress
      ? await db
        .select({ id: customers.id })
        .from(projectContacts)
        .innerJoin(customers, eq(projectContacts.sourceEntityId, customers.id))
        .where(
          and(
            eq(projectContacts.projectId, input.projectId),
            eq(projectContacts.sourceEntityType, "customer"),
          ),
        )
      : []
    const updatedAt = nowIso()
    const projectUpdate = db
      .update(projects)
      .set({
        projectNumber,
        address: projectAddress,
        mailingAddress,
        clientStatus: input.clientStatus,
        jobStatusId: input.jobStatusId,
        updatedAt,
      })
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
    const customerUpdates = linkedCustomers.map((customer) =>
      db
        .update(customers)
        .set({ address: mailingAddress, updatedAt })
        .where(eq(customers.id, customer.id)),
    )
    const auditInsert = db.insert(projectProfileAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: input.projectId,
      actorUserId: user.id,
      eventType: "project_information_updated",
      entityType: "project",
      entityId: input.projectId,
      beforeJson: JSON.stringify(existing),
      afterJson: JSON.stringify({
        projectNumber,
        projectAddress,
        mailingAddress,
        clientStatus: input.clientStatus,
        jobStatusId: input.jobStatusId,
      }),
      createdAt: updatedAt,
    })
    const syncOperationIds: string[] = []

    if (numberChanged) {
      if (!existing.projectNumber || !projectNumber) {
        return { success: false, error: "Project number is unavailable." }
      }
      const parts = projectNumberParts(projectNumber)
      if (!parts) return { success: false, error: "Invalid project number." }
      const reservationRows = await db
        .select({ id: projectNumberReservations.id })
        .from(projectNumberReservations)
        .where(and(eq(projectNumberReservations.projectId, input.projectId), eq(projectNumberReservations.organizationId, organizationId)))
        .limit(1)
      const reservationWrite = reservationRows[0]
        ? db
          .update(projectNumberReservations)
          .set({ projectNumber })
          .where(eq(projectNumberReservations.id, reservationRows[0].id))
        : db.insert(projectNumberReservations).values({
          id: crypto.randomUUID(),
          organizationId,
          projectId: input.projectId,
          department: parts.department,
          sequence: Number(parts.sequence),
          projectNumber,
          createdAt: updatedAt,
        })
      const driveOperationId = crypto.randomUUID()
      const trackerOperationId = crypto.randomUUID()
      syncOperationIds.push(driveOperationId, trackerOperationId)
      const syncPayload = JSON.stringify({
        previousProjectNumber: existing.projectNumber,
        projectNumber,
      })
      await db.batch([
        projectUpdate,
        ...customerUpdates,
        reservationWrite,
        db.insert(projectNumberAliases).values({
          id: crypto.randomUUID(),
          organizationId,
          projectId: input.projectId,
          projectNumber: existing.projectNumber,
          createdBy: user.id,
          createdAt: updatedAt,
        }).onConflictDoNothing(),
        db
          .update(projectExternalLinks)
          .set({ externalNumber: projectNumber, updatedAt })
          .where(
            and(
              eq(projectExternalLinks.projectId, input.projectId),
              eq(projectExternalLinks.externalNumber, existing.projectNumber),
            ),
          ),
        db.insert(projectProfileSyncOperations).values([
          {
            id: driveOperationId,
            organizationId,
            projectId: input.projectId,
            operation: "drive_folder_rename",
            status: "pending",
            payloadJson: syncPayload,
            error: null,
            attempts: 0,
            attemptedAt: null,
            completedAt: null,
            createdAt: updatedAt,
            updatedAt,
          },
          {
            id: trackerOperationId,
            organizationId,
            projectId: input.projectId,
            operation: "tracker_row_update",
            status: "pending",
            payloadJson: syncPayload,
            error: null,
            attempts: 0,
            attemptedAt: null,
            completedAt: null,
            createdAt: updatedAt,
            updatedAt,
          },
        ]),
        auditInsert,
      ])
    } else if (projectNumber) {
      const trackerOperationId = crypto.randomUUID()
      syncOperationIds.push(trackerOperationId)
      await db.batch([
        projectUpdate,
        ...customerUpdates,
        db.insert(projectProfileSyncOperations).values({
          id: trackerOperationId,
          organizationId,
          projectId: input.projectId,
          operation: "tracker_row_update",
          status: "pending",
          payloadJson: JSON.stringify({
            previousProjectNumber: projectNumber,
            projectNumber,
          }),
          error: null,
          attempts: 0,
          attemptedAt: null,
          completedAt: null,
          createdAt: updatedAt,
          updatedAt,
        }),
        auditInsert,
      ])
    } else {
      await db.batch([projectUpdate, ...customerUpdates, auditInsert])
    }
    await Promise.all(
      syncOperationIds.map((operationId) =>
        retryProjectProfileSyncOperation({ projectId: input.projectId, operationId }),
      ),
    )
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to update project information", error)
    return { success: false, error: "Unable to update project information." }
  }
}

export async function createProjectNote(input: {
  readonly projectId: string
  readonly body: string
}): Promise<ProjectProfileResult> {
  try {
    const body = nullableText(input.body)
    if (!body) return { success: false, error: "Enter a note." }
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    const timestamp = nowIso()
    const id = crypto.randomUUID()
    await db.insert(projectNotes).values({
      id,
      organizationId,
      projectId: input.projectId,
      content: body,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      deletedBy: null,
    })
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "project_note_created", entityType: "project_note", entityId: id, before: null, after: { body } })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to create project note", error)
    return { success: false, error: "Unable to create project note." }
  }
}

export async function deleteProjectNote(input: {
  readonly projectId: string
  readonly noteId: string
}): Promise<ProjectProfileResult> {
  try {
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    const noteRows = await db
      .select({ content: projectNotes.content })
      .from(projectNotes)
      .where(and(eq(projectNotes.id, input.noteId), eq(projectNotes.projectId, input.projectId), isNull(projectNotes.deletedAt)))
      .limit(1)
    const note = noteRows[0]
    if (!note) return { success: false, error: "Note not found." }
    const timestamp = nowIso()
    await db
      .update(projectNotes)
      .set({ deletedAt: timestamp, deletedBy: user.id, updatedBy: user.id, updatedAt: timestamp })
      .where(eq(projectNotes.id, input.noteId))
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "project_note_deleted", entityType: "project_note", entityId: input.noteId, before: note, after: null })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to delete project note", error)
    return { success: false, error: "Unable to delete project note." }
  }
}

export async function createProjectInteraction(input: {
  readonly projectId: string
  readonly interactionType: string
  readonly direction: "inbound" | "outbound"
  readonly summary: string
  readonly occurredAt: string
  readonly contactId: string | null
}): Promise<ProjectProfileResult> {
  try {
    const summary = nullableText(input.summary)
    const occurredAt = nullableText(input.occurredAt)
    if (!summary || !occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
      return { success: false, error: "Enter a summary and valid interaction time." }
    }
    const interactionType = nullableText(input.interactionType)
    if (!interactionType) return { success: false, error: "Choose an interaction type." }
    if (!isMeaningfulClientInteraction({
      interactionType,
      direction: input.direction,
      source: "manual",
    })) {
      return { success: false, error: "Choose a valid client interaction type and direction." }
    }
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (!input.contactId) return { success: false, error: "Choose an active client contact." }
    const contactRows = await db
      .select({ id: projectContacts.id })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, input.contactId),
          eq(projectContacts.projectId, input.projectId),
          eq(projectContacts.contactType, "owner"),
          eq(projectContacts.active, true),
        ),
      )
      .limit(1)
    if (!contactRows[0]) return { success: false, error: "Choose an active client contact on this project." }
    const timestamp = nowIso()
    const id = crypto.randomUUID()
    await db.insert(projectInteractions).values({
      id,
      organizationId,
      projectId: input.projectId,
      projectContactId: input.contactId,
      interactionType,
      direction: input.direction,
      summary,
      source: "manual",
      qualifiesForClientTouch: true,
      occurredAt: new Date(occurredAt).toISOString(),
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      deletedBy: null,
    })
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "client_interaction_created", entityType: "project_interaction", entityId: id, before: null, after: { interactionType, direction: input.direction, summary, occurredAt } })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to create client interaction", error)
    return { success: false, error: "Unable to create client interaction." }
  }
}

export async function deleteProjectInteraction(input: {
  readonly projectId: string
  readonly interactionId: string
}): Promise<ProjectProfileResult> {
  try {
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    const interactionRows = await db
      .select({ summary: projectInteractions.summary, occurredAt: projectInteractions.occurredAt })
      .from(projectInteractions)
      .where(and(eq(projectInteractions.id, input.interactionId), eq(projectInteractions.projectId, input.projectId), isNull(projectInteractions.deletedAt)))
      .limit(1)
    const interaction = interactionRows[0]
    if (!interaction) return { success: false, error: "Interaction not found." }
    const timestamp = nowIso()
    await db
      .update(projectInteractions)
      .set({ deletedAt: timestamp, deletedBy: user.id, updatedBy: user.id, updatedAt: timestamp })
      .where(eq(projectInteractions.id, input.interactionId))
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "client_interaction_deleted", entityType: "project_interaction", entityId: input.interactionId, before: interaction, after: null })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to delete client interaction", error)
    return { success: false, error: "Unable to delete client interaction." }
  }
}

export async function setProjectFollowUp(input: {
  readonly projectId: string
  readonly nextFollowUpAt: string
  readonly ownerUserId: string | null
}): Promise<ProjectProfileResult> {
  try {
    const nextFollowUpAt = nullableText(input.nextFollowUpAt)
    if (!nextFollowUpAt || Number.isNaN(new Date(nextFollowUpAt).getTime())) {
      return { success: false, error: "Choose a valid follow-up date." }
    }
    const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (input.ownerUserId) {
      const ownerRows = await db
        .select({ active: users.isActive, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, input.ownerUserId),
          ),
        )
        .limit(1)
      if (!ownerRows[0] || !isEligibleFollowUpOwner(ownerRows[0])) {
        return { success: false, error: "Choose an active internal organization member." }
      }
    }
    const timestamp = nowIso()
    await db
      .insert(projectFollowUps)
      .values({
        projectId: input.projectId,
        organizationId,
        nextFollowUpAt: new Date(nextFollowUpAt).toISOString(),
        ownerUserId: input.ownerUserId,
        createdBy: user.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: projectFollowUps.projectId,
        set: { nextFollowUpAt: new Date(nextFollowUpAt).toISOString(), ownerUserId: input.ownerUserId, updatedAt: timestamp },
      })
    await writeAuditEvent({ db, organizationId, projectId: input.projectId, actorId: user.id, eventType: "project_follow_up_set", entityType: "project_follow_up", entityId: input.projectId, before: null, after: { nextFollowUpAt, ownerUserId: input.ownerUserId } })
    revalidateProjectProfile(input.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to set project follow-up", error)
    return { success: false, error: "Unable to set project follow-up." }
  }
}

export async function clearProjectFollowUp(projectId: string): Promise<ProjectProfileResult> {
  try {
    const { db, organizationId, user } = await projectProfileContext(projectId, "update")
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    const followUpRows = await db
      .select({ nextFollowUpAt: projectFollowUps.nextFollowUpAt, ownerUserId: projectFollowUps.ownerUserId })
      .from(projectFollowUps)
      .where(eq(projectFollowUps.projectId, projectId))
      .limit(1)
    const followUp = followUpRows[0]
    if (!followUp) return { success: true }
    await db.delete(projectFollowUps).where(eq(projectFollowUps.projectId, projectId))
    await writeAuditEvent({ db, organizationId, projectId, actorId: user.id, eventType: "project_follow_up_cleared", entityType: "project_follow_up", entityId: projectId, before: followUp, after: null })
    revalidateProjectProfile(projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to clear project follow-up", error)
    return { success: false, error: "Unable to clear project follow-up." }
  }
}

export async function createCustomProjectJobStatus(input: {
  readonly label: string
  readonly sageCode: string | null
  readonly followUpCadenceDays: number | null
}): Promise<ProjectProfileResult> {
  try {
    const user = await requireAuth()
    requireFeaturePermission(user, "project-hub", "update")
    if (!canManageProjectRegistry(user)) return { success: false, error: "Only project registry managers can add job statuses." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("Database unavailable")
    const db = getDb(env.DB)
    const label = nullableText(input.label)
    if (!label) return { success: false, error: "Enter a job-status label." }
    if (input.followUpCadenceDays !== null && (!Number.isInteger(input.followUpCadenceDays) || input.followUpCadenceDays < 1)) {
      return { success: false, error: "Follow-up cadence must be a positive whole number." }
    }
    const timestamp = nowIso()
    await db.insert(projectJobStatuses).values({
      id: crypto.randomUUID(), organizationId, label, sageCode: nullableText(input.sageCode), followUpCadenceDays: input.followUpCadenceDays, active: true, sortOrder: 999, createdBy: user.id, createdAt: timestamp, updatedAt: timestamp,
    })
    revalidatePath("/dashboard/projects")
    return { success: true }
  } catch (error) {
    console.error("Unable to add job status", error)
    return { success: false, error: "Unable to add job status." }
  }
}

export async function deactivateCustomProjectJobStatus(
  statusId: string,
): Promise<ProjectProfileResult> {
  try {
    const user = await requireAuth()
    requireFeaturePermission(user, "project-hub", "update")
    if (!canManageProjectRegistry(user)) {
      return { success: false, error: "Only project registry managers can manage job statuses." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("Database unavailable")
    const db = getDb(env.DB)
    await db
      .update(projectJobStatuses)
      .set({ active: false, updatedAt: nowIso() })
      .where(and(eq(projectJobStatuses.id, statusId), eq(projectJobStatuses.organizationId, organizationId)))
    revalidatePath("/dashboard/projects")
    return { success: true }
  } catch (error) {
    console.error("Unable to deactivate project job status", error)
    return { success: false, error: "Unable to deactivate project job status." }
  }
}
