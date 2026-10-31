/**
 * The project Information page: what it shows, and saving its fields
 * (department, addresses, public identity, client and job status, and an
 * address suffix on the project number).
 */
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm"

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
  projectNumberRetirements,
  projectProfileSyncOperations,
  projects,
  users,
} from "@/db/schema"
import { isDemoUser } from "@/lib/demo"
import { updateCustomerByIdStatement } from "@/lib/domain/contacts/store"
import { insertProjectNumberAliasIfAbsentStatement, insertProjectNumberReservationStatement, updateProjectNumberReservationsStatement } from "@/lib/domain/project/numbering-store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { validJobStatus } from "@/lib/domain/project/job-status"
import { projectProfileContext } from "@/lib/domain/project/profile-access"
import { canRetrySyncOperation, projectClientStatus, type ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import {
  insertProjectProfileSyncOperationStatement,
  updateProjectExternalLinksStatement,
  updateProjectsStatement,
} from "@/lib/domain/project/store"
import { PROJECT_CLIENT_STATUSES } from "@/lib/domain/project/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { WorkspaceKind } from "@/lib/internal-duties/model"
import type { PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import { isProjectDepartment, resolvedProjectDepartment, type ProjectDepartment } from "@/lib/project-branding"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import {
  buildProjectNumberWithAddressSuffix,
  legacyProjectStatusAfterClientUpdate,
  projectInteractionTypeLabel,
  projectInteractionTypeOptions,
  projectJobStatusOptions,
  projectNumberParts,
  type ProjectClientStatus,
  type ProjectInteractionTypeOption,
  type ProjectJobStatusOption,
} from "@/lib/project-profile"
import { cleanText } from "@/lib/shared/guards"
import { validatePublicProjectIdentity } from "@/lib/social/privacy"

type ProjectProfileNote = {
  readonly id: string
  readonly body: string
  readonly authorName: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

type ProjectProfileInteraction = {
  readonly id: string
  readonly interactionType: string
  readonly interactionTypeLabel: string
  readonly direction: string
  readonly summary: string
  readonly source: string
  readonly occurredAt: string
  readonly authorName: string | null
  readonly contactId: string | null
}

export type ProjectInformation = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly department: ProjectDepartment | null
    readonly projectAddress: string | null
    readonly mailingAddress: string | null
    readonly publicTitle: string | null
    readonly publicLocationCity: string | null
    readonly clientStatus: ProjectClientStatus
    readonly jobStatusId: string
    readonly status: string
    readonly portfolioMapVisibility: PortfolioMapVisibility
    /** Internal workspace kind; null for client jobs. */
    readonly workspaceKind: WorkspaceKind | null
    readonly internalDepartment: boolean
  }
  readonly jobStatuses: readonly ProjectJobStatusOption[]
  readonly interactionTypes: readonly ProjectInteractionTypeOption[]
  /** What a logged client contact must include (Settings → Workflows). */
  readonly interactionRules: { readonly minimumSummaryCharacters: number; readonly maximumBackdateDays: number }
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
  /** Client follow-up aging by the company's thresholds; null when the status isn't followed up. */
  readonly followUpSignal: ProjectFollowUpSignal | null
  readonly syncOperations: readonly {
    readonly id: string
    readonly operation: string
    readonly status: string
    readonly error: string | null
    readonly updatedAt: string
    /** Server-decided: whether the page offers Retry. */
    readonly canRetry: boolean
  }[]
}

export async function loadProjectInformation(projectId: string): Promise<ProjectInformation | null> {
  const { db, organizationId } = await projectProfileContext(projectId, "read")
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      department: projects.department,
      projectAddress: projects.address,
      mailingAddress: projects.mailingAddress,
      publicTitle: projects.publicTitle,
      publicLocationCity: projects.publicLocationCity,
      clientStatus: projects.clientStatus,
      jobStatusId: projects.jobStatusId,
      status: projects.status,
      portfolioMapVisibility: projects.portfolioMapVisibility,
      workspaceKind: projects.workspaceKind,
      internalDepartment: projects.internalDepartment,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  const project = projectRows[0]
  if (!project) return null

  const [customStatuses, customInteractionTypes, notes, interactions, followUps, operations, aliases, clientContacts] = await Promise.all([
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
      .selectDistinct({ interactionType: projectInteractions.interactionType })
      .from(projectInteractions)
      .where(
        and(
          eq(projectInteractions.organizationId, organizationId),
          eq(projectInteractions.source, "manual"),
          like(projectInteractions.interactionType, "custom:%"),
        ),
      )
      .orderBy(asc(projectInteractions.interactionType)),
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

  return {
    project: {
      ...project,
      department: resolvedProjectDepartment({
        department: project.department,
        projectId: project.id,
        projectNumber: project.projectNumber,
      }),
      clientStatus: projectClientStatus(project.clientStatus),
    },
    jobStatuses: projectJobStatusOptions(customStatuses, project.jobStatusId),
    interactionTypes: projectInteractionTypeOptions(
      customInteractionTypes.map((item) => item.interactionType),
    ),
    interactionRules: await readFeatureSettings(db, organizationId, "client-interactions"),
    clientContacts,
    projectNumberAliases: aliases.map((alias) => alias.projectNumber),
    notes,
    interactions: interactions.map((interaction) => ({
      ...interaction,
      interactionTypeLabel: projectInteractionTypeLabel(interaction.interactionType),
    })),
    followUp: followUps[0] ?? null,
    followUpSignal: await loadProjectFollowUpSignals(db, organizationId, [project], new Date())
      .then((signals) => signals.get(project.id) ?? null)
      .catch((error: unknown) => {
        console.error("Project follow-up aging unavailable", error instanceof Error ? error.message : error)
        return null
      }),
    syncOperations: operations.map((operation) => ({
      ...operation,
      canRetry: canRetrySyncOperation(operation.status),
    })),
  }
}

export type ProjectInformationInput = {
  readonly projectId: string
  readonly department: ProjectDepartment
  readonly projectAddress: string | null
  readonly mailingAddress: string | null
  readonly publicTitle: string | null
  readonly publicLocationCity: string | null
  readonly clientStatus: ProjectClientStatus
  readonly jobStatusId: string
  readonly addressSuffix: string | null
  readonly updateClientDefaultMailingAddress: boolean
}

/** The saved result, plus the Google sync operations the caller should run now. */
export type ProjectInformationSave = {
  readonly result: ProjectProfileResult
  readonly syncOperationIds: readonly string[]
}

function refused(error: string): ProjectInformationSave {
  return { result: { success: false, error }, syncOperationIds: [] }
}

function pendingSyncOperation(input: {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly operation: "drive_folder_rename" | "tracker_row_update"
  readonly payloadJson: string
  readonly now: string
}): typeof projectProfileSyncOperations.$inferInsert {
  return {
    id: input.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    operation: input.operation,
    status: "pending",
    payloadJson: input.payloadJson,
    error: null,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/** Throws on unexpected failures; the action reports them generically. */
export async function saveProjectInformation(input: ProjectInformationInput): Promise<ProjectInformationSave> {
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return refused("Demo data cannot be changed.")
  if (!PROJECT_CLIENT_STATUSES.includes(input.clientStatus)) {
    return refused("Choose Lead or Customer.")
  }
  if (!isProjectDepartment(input.department)) {
    return refused("Choose ORC, HPS, Nu-Tech, or Design.")
  }
  if (!(await validJobStatus({ db, organizationId, jobStatusId: input.jobStatusId }))) {
    return refused("Choose an active governed job status.")
  }

  const existingRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      clientName: projects.clientName,
      projectNumber: projects.projectNumber,
      department: projects.department,
      status: projects.status,
      address: projects.address,
      mailingAddress: projects.mailingAddress,
      clientStatus: projects.clientStatus,
      jobStatusId: projects.jobStatusId,
      publicTitle: projects.publicTitle,
      publicLocationCity: projects.publicLocationCity,
    })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  const existing = existingRows[0]
  if (!existing) return refused("Project not found.")

  const projectAddress = cleanText(input.projectAddress)
  const mailingAddress = cleanText(input.mailingAddress)
  const publicTitle = cleanText(input.publicTitle)
  const publicLocationCity = cleanText(input.publicLocationCity)
  if ((publicTitle === null) !== (publicLocationCity === null)) {
    return refused("Add both a privacy-safe public project title and a town/city, or leave both blank.")
  }
  if (publicTitle && publicLocationCity) {
    const identityErrors = validatePublicProjectIdentity({
      publicTitle,
      locationCity: publicLocationCity,
      internalProjectName: existing.name,
      clientName: existing.clientName,
    })
    if (identityErrors.length > 0) {
      return refused(identityErrors.join(" "))
    }
  }
  let projectNumber = existing.projectNumber
  if (input.addressSuffix !== null && existing.projectNumber) {
    try {
      projectNumber = buildProjectNumberWithAddressSuffix(
        existing.projectNumber,
        input.addressSuffix,
      )
    } catch (error) {
      return refused(error instanceof Error ? error.message : "Invalid project-number suffix.")
    }
  }

  const numberChanged = projectNumber !== existing.projectNumber && projectNumber !== null
  if (numberChanged) {
    const requestedProjectNumber = projectNumber
    if (!requestedProjectNumber) return refused("Project number is unavailable.")
    const requestedParts = projectNumberParts(requestedProjectNumber)
    const [projectConflict, aliasConflict, retirementConflict] = await Promise.all([
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
      db.select({ formerProjectId: projectNumberRetirements.formerProjectId }).from(projectNumberRetirements).where(and(
        eq(projectNumberRetirements.organizationId, organizationId),
        requestedParts ? or(eq(projectNumberRetirements.projectNumber, requestedProjectNumber), and(eq(projectNumberRetirements.department, requestedParts.department), eq(projectNumberRetirements.sequence, Number(requestedParts.sequence)))) : eq(projectNumberRetirements.projectNumber, requestedProjectNumber),
      )).limit(1),
    ])
    if (projectConflict[0] && projectConflict[0].id !== existing.id) {
      return refused("That project number already exists.")
    }
    if (aliasConflict[0] && aliasConflict[0].projectId !== existing.id) {
      return refused("That project number is reserved by a historical project record.")
    }
    if (retirementConflict[0] && retirementConflict[0].formerProjectId !== existing.id) return refused("That department and sequence were retired with a removed project.")
  }

  const linkedCustomers = input.updateClientDefaultMailingAddress
    ? await db
      .select({
        id: customers.id,
        sageClientId: customers.sageClientId,
        sageClientNumber: customers.sageClientNumber,
      })
      .from(projectContacts)
      .innerJoin(customers, eq(projectContacts.sourceEntityId, customers.id))
      .where(
        and(
          eq(projectContacts.projectId, input.projectId),
          eq(projectContacts.sourceEntityType, "customer"),
          eq(customers.organizationId, organizationId),
        ),
      )
    : []
  if (linkedCustomers.some((customer) => customer.sageClientId || customer.sageClientNumber)) {
    return refused("This client is linked to Sage. Update its default mailing address through Contacts review, or leave the client-default option unchecked.")
  }
  const updatedAt = new Date().toISOString()
  const legacyStatus = legacyProjectStatusAfterClientUpdate({
    currentStatus: existing.status,
    clientStatus: input.clientStatus,
  })
  const projectUpdate = updateProjectsStatement(
    db,
    and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)),
    {
      projectNumber,
      department: input.department,
      status: legacyStatus,
      address: projectAddress,
      mailingAddress,
      clientStatus: input.clientStatus,
      jobStatusId: input.jobStatusId,
      publicTitle,
      publicLocationCity,
      updatedAt,
    },
  )
  const customerUpdates = linkedCustomers.map((customer) =>
    updateCustomerByIdStatement(db, { customerId: customer.id, values: { address: mailingAddress, updatedAt } }),
  )
  const auditInsert = recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "project_information_updated",
    entityType: "project",
    entityId: input.projectId,
    beforeJson: JSON.stringify(existing),
    afterJson: JSON.stringify({
      projectNumber,
      department: input.department,
      projectAddress,
      mailingAddress,
      clientStatus: input.clientStatus,
      jobStatusId: input.jobStatusId,
      publicTitle,
      publicLocationCity,
      status: legacyStatus,
    }),
    createdAt: updatedAt,
  })

  if (numberChanged) {
    if (!existing.projectNumber || !projectNumber) {
      return refused("Project number is unavailable.")
    }
    const parts = projectNumberParts(projectNumber)
    if (!parts) return refused("Invalid project number.")
    const reservationRows = await db
      .select({ id: projectNumberReservations.id })
      .from(projectNumberReservations)
      .where(and(eq(projectNumberReservations.projectId, input.projectId), eq(projectNumberReservations.organizationId, organizationId)))
      .limit(1)
    const reservationWrite = reservationRows[0]
      ? updateProjectNumberReservationsStatement(db, eq(projectNumberReservations.id, reservationRows[0].id), { projectNumber })
      : insertProjectNumberReservationStatement(db, {
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
    const payloadJson = JSON.stringify({
      previousProjectNumber: existing.projectNumber,
      projectNumber,
    })
    await db.batch([
      projectUpdate,
      ...customerUpdates,
      reservationWrite,
      insertProjectNumberAliasIfAbsentStatement(db, {
        id: crypto.randomUUID(),
        organizationId,
        projectId: input.projectId,
        projectNumber: existing.projectNumber,
        createdBy: user.id,
        createdAt: updatedAt,
      }),
      updateProjectExternalLinksStatement(
        db,
        and(
          eq(projectExternalLinks.projectId, input.projectId),
          eq(projectExternalLinks.externalNumber, existing.projectNumber),
        ),
        { externalNumber: projectNumber, updatedAt },
      ),
      insertProjectProfileSyncOperationStatement(db, [
        pendingSyncOperation({ id: driveOperationId, organizationId, projectId: input.projectId, operation: "drive_folder_rename", payloadJson, now: updatedAt }),
        pendingSyncOperation({ id: trackerOperationId, organizationId, projectId: input.projectId, operation: "tracker_row_update", payloadJson, now: updatedAt }),
      ]),
      auditInsert,
    ])
    return { result: { success: true }, syncOperationIds: [driveOperationId, trackerOperationId] }
  }
  if (projectNumber) {
    const trackerOperationId = crypto.randomUUID()
    await db.batch([
      projectUpdate,
      ...customerUpdates,
      insertProjectProfileSyncOperationStatement(db, pendingSyncOperation({
        id: trackerOperationId,
        organizationId,
        projectId: input.projectId,
        operation: "tracker_row_update",
        payloadJson: JSON.stringify({
          previousProjectNumber: projectNumber,
          projectNumber,
        }),
        now: updatedAt,
      })),
      auditInsert,
    ])
    return { result: { success: true }, syncOperationIds: [trackerOperationId] }
  }
  await db.batch([projectUpdate, ...customerUpdates, auditInsert])
  return { result: { success: true }, syncOperationIds: [] }
}
