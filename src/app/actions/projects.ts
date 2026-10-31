"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { projectOperations } from "@/db/schema"
import { loadProjectListForRequest, type ProjectListItem } from "@/lib/projects/project-list"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import { operationInsertQuery, operationUpdateQuery } from "@/lib/domain/operations/store"
import {
  driveProvisionedStatements,
  driveProvisioningOptions,
  prepareProjectDriveProvisioning,
  provisionIntakeDriveFolder,
} from "@/lib/domain/project/drive-provisioning"
import {
  allocateIntakeProjectNumber,
  confirmedDistinctDecisionStatements,
  intakeCustomerValues,
  intakeRecordStatements,
  intakeSageWritePayload,
  projectNumberExists,
  prospectiveDuplicates,
  resolveIntakeAssignee,
  resolveIntakeCustomer,
  newIntakeIds,
  type IntakeIds,
} from "@/lib/domain/project/intake"
import {
  readIntakeTrackerSheets,
  spreadsheetUrl,
  intakeTrackerRowValues,
  writeIntakeTrackers,
} from "@/lib/domain/project/intake-trackers"
import type {
  CreateProjectIntakeInput,
  CreateProjectIntakeResult,
  CreateProjectShellInput,
  CreateProjectShellResult,
  ProjectIntakeAssignee,
  ProjectIntakeCustomerOption,
  ProvisionProjectDriveResult,
} from "@/lib/domain/project/intake-types"
import { loadIntakeAssignees, loadIntakeCustomerOptions } from "@/lib/domain/project/listing"
import {
  intakeClientName,
  isProjectSequenceConflict,
  joinedAddress,
  normalizedIntakeDepartment,
  projectSequence,
  requireText,
  shellProjectId,
  type SageClientJobPayload,
} from "@/lib/domain/project/rules"
import {
  resolveShellCustomer,
  resolveShellJobStatus,
  shellRecordStatements,
  shellSageWritePayload,
} from "@/lib/domain/project/intake-shell"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import {
  buildProjectDriveFolderName,
  provisionProjectDriveFolder as provisionGoogleProjectDriveFolder,
} from "@/lib/google/project-drive-provisioning"
import {
  PROJECT_REGISTRY_DESTINATION,
  type ProjectTrackingDestination,
} from "@/lib/google/project-intake-tracker"
import { projectWorkspaceClients } from "@/lib/google/project-workspace"
import { requireOrg } from "@/lib/org-scope"
import { canCreateProjectDriveFolder, requirePermission } from "@/lib/permissions"
import { getProjectAccessRecord } from "@/lib/project-access"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import {
  parseSageClientStatusId,
  parseSageJobTypeId,
  sageJobTypeName,
} from "@/lib/sage/client-project-write"
import { insertSageClientProjectWriteOperation } from "@/lib/domain/sage-bridge/store"

export type { ProjectListItem } from "@/lib/projects/project-list"
export type {
  CreateProjectIntakeInput,
  CreateProjectIntakeResult,
  CreateProjectShellInput,
  ProjectIntakeAssignee,
  ProjectIntakeCustomerOption,
  ProjectStatusValue,
  ProvisionProjectDriveResult,
} from "@/lib/domain/project/intake-types"

export async function getProjectIntakeCustomerOptions(): Promise<readonly ProjectIntakeCustomerOption[]> {
  const user = await requireAuth()
  requirePermission(user, "project", "create")
  const { requireFeaturePermission } = await import("@/lib/permission-enforcement")
  await requireFeaturePermission(user, "customers", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  return loadIntakeCustomerOptions(db, organizationId)
}

export async function getProjectIntakeAssignees(): Promise<readonly ProjectIntakeAssignee[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const { requireFeaturePermission } = await import("@/lib/permission-enforcement")
    await requireFeaturePermission(user, "internal-directory", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const db = getDb(env.DB)
    return await loadIntakeAssignees(db, organizationId)
  } catch {
    return []
  }
}

/**
 * The tracker-write and Sage handoff operations an intake queues, plus the
 * Sage client/job write request. These rows belong to the operations and
 * Sage queues, so they are written here beside the project rows.
 */
function intakeQueueStatements(
  db: Db,
  input: {
    readonly ids: IntakeIds
    readonly organizationId: string
    readonly customerId: string
    readonly requestedByUserId: string
    readonly projectNumber: string
    readonly intake: CreateProjectIntakeInput
    readonly departmentDestination: ProjectTrackingDestination
    readonly sageWritePayload: SageClientJobPayload
    readonly now: string
  },
) {
  const { ids, projectNumber, intake, departmentDestination, sageWritePayload, now } = input
  const { projectId } = ids
  return [
    operationInsertQuery(db, {
      id: ids.operationId,
      projectId,
      sourceSystem: "google_developer_project_tracking",
      sourceRecordType: "project_intake",
      sourceRecordId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      sourceRecordNumber: projectNumber,
      title: `Write ${projectNumber} to Developer project trackers`,
      description:
        `Write Compass intake to Project Registry and ${departmentDestination.workbookTitle}.`,
      status: "open",
      priority: "high",
      assigneeName: cleanText(intake.assignedTo),
      companyName: cleanText(intake.companyName),
      externalUrl: spreadsheetUrl(
        PROJECT_REGISTRY_DESTINATION.spreadsheetId
      ),
      sageWriteStatus: "not_ready",
      syncDirection: "bidirectional",
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    operationInsertQuery(db, {
      id: ids.sageOperationId,
      projectId,
      sourceSystem: "compass_project_intake",
      sourceRecordType: "sage_project_handoff",
      sourceRecordId: projectNumber,
      sourceRecordNumber: projectNumber,
      title: `${projectNumber} Sage client/job write`,
      description:
        "Compass intake queued for the narrow Sage client/job writer.",
      status: "open",
      priority: "high",
      assigneeType: "internal",
      assigneeName: cleanText(intake.assignedTo),
      companyName: intakeClientName(intake),
      externalUrl: null,
      sageWriteStatus: "queued",
      sagePayloadJson: JSON.stringify(sageWritePayload),
      syncDirection: "write",
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    }),
    insertSageClientProjectWriteOperation(db, {
      id: ids.sageWriteOperationId,
      organizationId: input.organizationId,
      customerId: input.customerId,
      projectId,
      requestedByUserId: input.requestedByUserId,
      operationType: "ensure_client_and_job",
      idempotencyKey: `project:${projectId}`,
      payloadJson: JSON.stringify(sageWritePayload),
      status: "queued",
      requestedAt: now,
      updatedAt: now,
    }),
  ] as const
}

export async function createProjectIntake(
  input: CreateProjectIntakeInput
): Promise<CreateProjectIntakeResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const { requireFeaturePermission } = await import("@/lib/permission-enforcement")
    // Intake reads canonical client details and may create a new directory row.
    // The picker permission alone is not an authorization boundary for this action.
    await requireFeaturePermission(user, "customers", "read")
    const selectedCustomerId = cleanText(input.existingCustomerId ?? null)
    if (!selectedCustomerId) {
      await requireFeaturePermission(user, "customers", "create")
    }
    if (cleanText(input.assignedTo)) {
      await requireFeaturePermission(user, "internal-directory", "read")
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }
    const db = getDb(env.DB)

    const projectName = requireText(input.projectName, "Project name")
    const clientName = requireText(intakeClientName(input) ?? "", "Client")
    const sageClientStatusId = parseSageClientStatusId(input.sageClientStatusId)
    if (!sageClientStatusId) {
      return { success: false, error: "Choose a Sage client status." }
    }
    const sageJobStatus = PROJECT_JOB_STATUS_DEFINITIONS.find(
      (status) => status.id === input.sageJobStatusId
    )
    if (!sageJobStatus) {
      return { success: false, error: "Choose a Sage job status." }
    }
    const sageJobType = parseSageJobTypeId(input.sageJobType)
    if (!sageJobType) {
      return { success: false, error: "Choose a Sage job type." }
    }
    const department = normalizedIntakeDepartment(input.department)
    if (!department) {
      return { success: false, error: "Choose ORC, HPS, Nu-Tech, or Design." }
    }
    const { candidates: duplicateCandidates, unconfirmed } = await prospectiveDuplicates(db, organizationId, {
      projectNumber: null,
      name: projectName,
      clientName,
      address: joinedAddress(input),
    }, input.confirmedDistinctProjectIds)
    if (unconfirmed.length > 0) {
      return { success: false, duplicateWarning: true, candidates: unconfirmed }
    }
    const intakeDate = new Date().toISOString().slice(0, 10)
    const googleClients = await projectWorkspaceClients({
      environment: env,
      organizationId,
    })
    const submittingGoogleEmail = user.googleEmail ?? user.email
    const projectIntakeGoogleEmail = googleClients.projectIntakeGoogleEmail
    const trackers = await readIntakeTrackerSheets({
      sheets: googleClients.sheets,
      googleEmail: projectIntakeGoogleEmail,
      department,
    })
    const { departmentDestination, registryLayout, departmentLayout } = trackers
    if (!registryLayout || !departmentLayout) {
      return {
        success: false,
        error:
          "The Developer Project Registry or department Tracker headers could not be identified. No project was created.",
      }
    }
    const projectNumber = await allocateIntakeProjectNumber(db, {
      organizationId,
      department,
      streetNumber: input.streetNumber,
      registryRows: trackers.registryRows,
      registryLayout,
      departmentRows: trackers.departmentRows,
      departmentLayout,
    })
    const sequence = projectSequence(projectNumber)
    if (await projectNumberExists(db, organizationId, projectNumber)) {
      return {
        success: false,
        error: `Compass project ${projectNumber} already exists. Refresh and try again.`,
      }
    }

    const customer = await resolveIntakeCustomer(db, {
      organizationId,
      selectedCustomerId,
      contactEmail: input.contactEmail,
      clientName,
      sageClientStatusId,
    })
    if (!customer.ok) return { success: false, error: customer.error }
    const customerMatch = customer.customer
    const customerId = customerMatch?.id ?? crypto.randomUUID()

    const assignee = await resolveIntakeAssignee(db, { organizationId, assignedTo: input.assignedTo })
    if (!assignee.ok) return { success: false, error: assignee.error }

    const now = new Date().toISOString()
    const ids = newIntakeIds(projectNumber, assignee.assignedTo !== null)
    const { projectId } = ids
    const driveFolderName = buildProjectDriveFolderName({
      projectNumber,
      projectName,
      streetNumber: input.streetNumber,
      streetName: input.streetName,
    })
    const customerValues = intakeCustomerValues({
      customerId,
      organizationId,
      customerMatch,
      clientName,
      intake: input,
      sageClientStatusId,
      now,
    })
    const sageWritePayload = intakeSageWritePayload({
      customerValues,
      customerMatch,
      intake: input,
      projectId,
      projectNumber,
      projectName,
      jobStatusLabel: sageJobStatus.label,
      jobType: sageJobType,
    })

    try {
      await db.batch([
        ...intakeRecordStatements(db, {
          ids,
          organizationId,
          projectNumber,
          sequence,
          department,
          projectName,
          address: joinedAddress(input),
          driveFolderName,
          departmentDestination,
          jobStatus: sageJobStatus,
          sageJobTypeName: sageJobTypeName(sageJobType),
          customerValues,
          customerMatch,
          assignee,
          now,
        }),
        ...intakeQueueStatements(db, {
          ids,
          organizationId,
          customerId,
          requestedByUserId: user.id,
          projectNumber,
          intake: input,
          departmentDestination,
          sageWritePayload,
          now,
        }),
        ...confirmedDistinctDecisionStatements(db, {
          organizationId,
          projectId,
          candidates: duplicateCandidates,
          resolvedByUserId: user.id,
          now,
        }),
      ])
    } catch (error) {
      if (isProjectSequenceConflict(error)) {
        return {
          success: false,
          error:
            "Another intake claimed that department number. Your entries are still here; submit again to receive the next number.",
        }
      }
      throw error
    }

    // Order matters: the Drive folder is created after the project rows are
    // saved, and the tracker rows carry the folder link once it exists.
    const { driveStatus, projectDriveUrl, warning } = await provisionIntakeDriveFolder(db, {
      googleClients,
      googleEmail: submittingGoogleEmail,
      department,
      folderName: driveFolderName,
      projectId,
      driveLinkId: ids.driveLinkId,
      // The Sage handoff operation carries the folder link too.
      operationReceipt: (folderUrl, syncedAt) =>
        operationUpdateQuery(db, eq(projectOperations.id, ids.sageOperationId), { externalUrl: folderUrl, updatedAt: syncedAt }),
    })

    const tracking = await writeIntakeTrackers(db, {
      sheets: googleClients.sheets,
      googleEmail: projectIntakeGoogleEmail,
      trackers,
      registryLayout,
      departmentLayout,
      ...intakeTrackerRowValues({
        registryLayout,
        departmentLayout,
        departmentDestination,
        intake: input,
        department,
        projectName,
        intakeDate,
        customerValues,
        projectNumber,
        driveFolderUrl: projectDriveUrl,
        createdBy: user.displayName ?? user.email,
      }),
      projectNumber,
      department,
      registryLinkId: ids.registryLinkId,
      departmentTrackerLinkId: ids.departmentTrackerLinkId,
      warning,
      // The tracker-write operation completes once both rows are written.
      operationReceipt: (trackerStatus, trackingSyncedAt) =>
        operationUpdateQuery(db, eq(projectOperations.id, ids.operationId), {
          status: trackerStatus === "written" ? "completed" : "open",
          syncStatus: trackerStatus === "written" ? "mapped" : "pending",
          lastSyncedAt: trackerStatus === "written" ? trackingSyncedAt : null,
          updatedAt: trackingSyncedAt,
        }),
    })
    const { trackerStatus } = tracking

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "account",
      action: "project.created",
      entityType: "project",
      entityId: projectId,
      summary: `Created ${projectNumber} — ${projectName}.`,
      metadata: {
        department,
        trackerStatus,
        driveStatus,
        sageStatus: "queued",
      },
    })
    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard")
    return {
      success: true,
      id: projectId,
      projectNumber,
      trackerStatus,
      driveStatus,
      sageStatus: "queued",
      warning: tracking.warning,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    }
  }
}

export async function provisionProjectDriveFolder(
  projectId: string
): Promise<ProvisionProjectDriveResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    requirePermission(user, "document", "create")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }
    const db = getDb(env.DB)
    // Office staff on the job can create its folder: it always lands in the
    // company's standard structure, and an existing folder is relinked, never
    // duplicated.
    if (
      !canCreateProjectDriveFolder(user) ||
      !(await getProjectAccessRecord(db, user, projectId))
    ) {
      return {
        success: false,
        error: "Permission denied: you can't create Drive folders for this project",
      }
    }
    const target = await prepareProjectDriveProvisioning(db, { organizationId, projectId })
    if (!target.ok) return { success: false, error: target.error }
    const googleClients = await projectWorkspaceClients({
      environment: env,
      organizationId,
    })
    const drive = await provisionGoogleProjectDriveFolder(
      googleClients.drive,
      user.googleEmail ?? user.email,
      {
        department: target.department,
        folderName: target.folderName,
        templateEmail: googleClients.projectIntakeGoogleEmail,
        ...driveProvisioningOptions(target),
      }
    )
    const now = new Date().toISOString()
    const writes = driveProvisionedStatements(db, { target, drive, now })
    const sageOperationUpdate = operationUpdateQuery(
      db,
      and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "sage_project_handoff")),
      { externalUrl: drive.folderUrl, updatedAt: now }
    )
    await db.batch([
      writes.projectUpdate,
      sageOperationUpdate,
      ...writes.familyWrites,
      writes.linkWrite,
    ])
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "file",
      action: "project.drive_provisioned",
      entityType: "project",
      entityId: projectId,
      summary: `Provisioned the Drive folder for ${target.project.projectNumber}.`,
      metadata: {
        folderId: drive.folderId,
        createdRoot: drive.createdRoot,
        createdChildCount: drive.createdChildCount,
        copiedFileCount: drive.copiedFileCount,
      },
    })
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard/projects")
    revalidatePath("/dashboard/files")
    return {
      success: true,
      folderId: drive.folderId,
      folderUrl: drive.folderUrl,
      createdRoot: drive.createdRoot,
      createdChildCount: drive.createdChildCount,
      copiedFileCount: drive.copiedFileCount,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to provision Drive",
    }
  }
}

export async function getProjects(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "read")
    return await loadProjectListForRequest(
      user.id,
      user.organizationId ?? null,
      user.organizationType === "internal" &&
        canUseOrganizationProjectScopeRole(user.role),
    )
  } catch {
    return []
  }
}

export async function createProjectShell(
  input: CreateProjectShellInput
): Promise<CreateProjectShellResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "create")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "D1 not available" }

    const db = getDb(env.DB)
    const projectNumber = cleanText(input.projectNumber)
    const name = requireText(input.name, "Project name")
    const clientName = requireText(input.clientName ?? "", "Client")
    const status = cleanText(input.status) ?? "OPEN"
    const sageClientStatusId = parseSageClientStatusId(input.sageClientStatusId)
    if (!sageClientStatusId) {
      return { success: false, error: "Choose a Sage client status." }
    }
    const sageJobStatus = await resolveShellJobStatus(db, orgId, input.sageJobStatusId)
    if (!sageJobStatus) {
      return { success: false, error: "Choose a Sage job status." }
    }
    const sageJobType = parseSageJobTypeId(input.sageJobType)
    if (!sageJobType) {
      return { success: false, error: "Choose a Sage job type." }
    }
    const { candidates: duplicateCandidates, unconfirmed } = await prospectiveDuplicates(db, orgId, {
      projectNumber,
      name,
      clientName,
      address: cleanText(input.address),
    }, input.confirmedDistinctProjectIds)
    if (unconfirmed.length > 0) {
      return { success: false, duplicateWarning: true, candidates: unconfirmed }
    }
    if (projectNumber && (await projectNumberExists(db, orgId, projectNumber))) {
      return {
        success: false,
        error: "A project with that Compass number already exists.",
      }
    }

    const now = new Date().toISOString()
    const id = shellProjectId(projectNumber, input.department, name, crypto.randomUUID().slice(0, 8))
    const customer = await resolveShellCustomer(db, { organizationId: orgId, clientName, sageClientStatusId })
    if (!customer.ok) return { success: false, error: customer.error }
    const customerMatch = customer.customer
    const customerId = customerMatch?.id ?? crypto.randomUUID()
    const address = cleanText(input.address)
    const payload = shellSageWritePayload({
      customerId,
      customerMatch,
      clientName,
      address,
      sageClientStatusId,
      id,
      projectNumber,
      name,
      jobStatusLabel: sageJobStatus.label,
      jobType: sageJobType,
    })

    await db.batch([
      ...shellRecordStatements(db, {
        shell: input,
        id,
        organizationId: orgId,
        projectNumber,
        name,
        status,
        address,
        clientName,
        jobStatus: sageJobStatus,
        sageJobTypeName: sageJobTypeName(sageJobType),
        customerId,
        customerMatch,
        sageClientStatusId,
        now,
      }),
      insertSageClientProjectWriteOperation(db, {
        id: crypto.randomUUID(),
        organizationId: orgId,
        customerId,
        projectId: id,
        requestedByUserId: user.id,
        operationType: "ensure_client_and_job",
        idempotencyKey: `project:${id}`,
        payloadJson: JSON.stringify(payload),
        status: "queued",
        requestedAt: now,
        updatedAt: now,
      }),
      ...confirmedDistinctDecisionStatements(db, {
        organizationId: orgId,
        projectId: id,
        candidates: duplicateCandidates,
        resolvedByUserId: user.id,
        now,
      }),
    ])

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${id}`)
    revalidatePath("/dashboard")
    return {
      success: true,
      id,
      sageStatus: "queued",
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create project",
    }
  }
}
