/**
 * Pushes a project-number or information change out to Google: renames the
 * project's Drive folder and rewrites its Project Registry and department
 * tracker rows. Each push is a recorded sync operation that can be retried.
 */
import { and, asc, desc, eq, or, sql } from "drizzle-orm"

import {
  customerContacts,
  customers,
  projectContacts,
  projectExternalLinks,
  projectProfileSyncOperations,
  projects,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { projectProfileContext } from "@/lib/domain/project/profile-access"
import {
  projectAddressParts,
  syncProjectNumbers,
  trackerDepartment,
  type ProjectProfileResult,
} from "@/lib/domain/project/profile-rules"
import { updateProjectProfileSyncOperations } from "@/lib/domain/project/store"
import { DriveClient } from "@/lib/google/client/drive-client"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { buildProjectDriveFolderName } from "@/lib/google/project-drive-provisioning"
import { resolveProjectIntakeIntegrationEmail } from "@/lib/google/project-intake-identity"
import {
  departmentTrackingDestination,
  locateProjectTrackerLayout,
  patchProjectTrackerCells,
  PROJECT_REGISTRY_DESTINATION,
  projectTrackerOwnerContact,
  updateProjectTrackerRow,
} from "@/lib/google/project-intake-tracker"
import type { AuthUser } from "@/lib/auth"
import type { Db } from "@/lib/server/action-context"

type SyncClients = { readonly drive: DriveClient; readonly sheets: SheetsClient; readonly trackerEmail: string }

async function projectSyncClients(input: {
  readonly db: Db
  readonly organizationId: string
  readonly environment: CloudflareEnv
}): Promise<SyncClients> {
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

type SyncProject = {
  readonly projectNumber: string
  readonly name: string
  readonly address: string | null
  readonly mailingAddress: string | null
  readonly clientName: string | null
  readonly googleDriveFolderId: string | null
}

async function renameDriveFolder(input: {
  readonly db: Db
  readonly projectId: string
  readonly project: SyncProject
  readonly clients: SyncClients
  readonly user: AuthUser
}): Promise<void> {
  const { db, project } = input
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
  await input.clients.drive.renameFile(input.user.googleEmail ?? input.user.email, folderId, folderName)
}

async function updateTrackerRows(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly project: SyncProject
  readonly clients: SyncClients
  readonly previousProjectNumber: string
}): Promise<void> {
  const { db, organizationId, project, clients } = input
  const department = trackerDepartment(project.projectNumber)
  if (!department) throw new Error("Project number has no supported tracker department.")
  const contactRows = await db
    .select({
      displayName: projectContacts.displayName,
      customerContactId: projectContacts.customerContactId,
      companyName: projectContacts.companyName,
      email: projectContacts.email,
      phone: projectContacts.phone,
      directoryPersonName: customerContacts.name,
      directoryPersonEmail: customerContacts.email,
      directoryPersonPhone: customerContacts.phone,
      directoryCompanyName: customers.company,
    })
    .from(projectContacts)
    .leftJoin(
      customers,
      and(
        or(
          eq(projectContacts.customerId, customers.id),
          and(
            eq(projectContacts.sourceEntityType, "customer"),
            eq(projectContacts.sourceEntityId, customers.id)
          )
        ),
        eq(customers.organizationId, organizationId)
      )
    )
    .leftJoin(
      customerContacts,
      and(
        eq(projectContacts.customerContactId, customerContacts.id),
        eq(customerContacts.customerId, customers.id),
        eq(customerContacts.active, true)
      )
    )
    .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
    .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder))
    .limit(1)
  const contact = contactRows[0]
  const address = projectAddressParts(project.address)
  const ownerContact = projectTrackerOwnerContact({
    projectClientName: project.clientName,
    assignmentName: contact?.displayName ?? null,
    assignmentCompanyName: contact?.companyName ?? null,
    assignmentEmail: contact?.email ?? null,
    assignmentPhone: contact?.phone ?? null,
    canonicalPersonId: contact?.customerContactId ?? null,
    canonicalPersonName: contact?.directoryPersonName ?? null,
    canonicalPersonEmail: contact?.directoryPersonEmail ?? null,
    canonicalPersonPhone: contact?.directoryPersonPhone ?? null,
    canonicalCompanyName: contact?.directoryCompanyName ?? null,
  })
  const clientName = ownerContact.name
  const companyName = ownerContact.companyName
  const nameParts = clientName.trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? ""
  const lastName = nameParts.slice(1).join(" ")
  const driveFolderUrl = project.googleDriveFolderId ? `https://drive.google.com/drive/folders/${project.googleDriveFolderId}` : ""
  const trackerDestination = departmentTrackingDestination(department)
  const registryRows = await clients.sheets.getValues(clients.trackerEmail, { spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId, range: "'Registry'!A:ZZ" })
  const registryLayout = locateProjectTrackerLayout(registryRows)
  if (!registryLayout) throw new Error("Project Registry has no Project Number or Project ID header.")
  const currentProjectNumbers = [input.previousProjectNumber, project.projectNumber]
  await updateProjectTrackerRow({
    sheets: clients.sheets,
    googleEmail: clients.trackerEmail,
    spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
    sheetTitle: PROJECT_REGISTRY_DESTINATION.sheetTitle,
    rows: registryRows,
    layout: registryLayout,
    currentProjectNumbers,
    patches: patchProjectTrackerCells({ layout: registryLayout, values: { "project id": project.projectNumber, "project number": project.projectNumber, "street number code": address.streetNumber ?? "", "street name label": address.streetName ?? project.name, "client first name": firstName, "client last name": lastName, "company name": companyName, "city state zip": address.cityStateZip ?? "", "folder link": driveFolderUrl, "lead tracker link": `https://docs.google.com/spreadsheets/d/${trackerDestination.spreadsheetId}` } }),
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
    currentProjectNumbers,
    patches: patchProjectTrackerCells({ layout: departmentLayout, values: { "project id": project.projectNumber, "project number": project.projectNumber, client: clientName, customer: clientName, "builder gc": companyName || clientName, "contact person": clientName, address: project.address ?? "", "project address": project.address ?? "", phone: ownerContact.phone, email: ownerContact.email, "billing address": project.mailingAddress ?? "", "folder link": driveFolderUrl } }),
  })
}

type SyncRetryOutcome = {
  readonly result: ProjectProfileResult
  /** False for the early refusals, which never touched the page's data. */
  readonly revalidate: boolean
}

/**
 * Runs one pending or failed sync operation. A failure is recorded on the
 * operation (attempts + 1, error) and returned as the error message.
 */
export async function retryProjectProfileSyncOperation(input: {
  readonly projectId: string
  readonly operationId: string
}): Promise<SyncRetryOutcome> {
  const attemptedAt = new Date().toISOString()
  try {
    const { db, organizationId, user, env } = await projectProfileContext(input.projectId, "update")
    if (isDemoUser(user.id)) return { result: { success: false, error: "Demo data cannot be changed." }, revalidate: false }
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
    if (!operation) return { result: { success: false, error: "Synchronization operation not found." }, revalidate: false }
    const numbers = syncProjectNumbers(operation.payloadJson)
    if (!numbers) return { result: { success: false, error: "Synchronization operation has invalid project-number data." }, revalidate: false }
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
    const row = projectRows[0]
    if (!row || !row.projectNumber) return { result: { success: false, error: "Project number is unavailable." }, revalidate: false }
    const project: SyncProject = { ...row, projectNumber: row.projectNumber }
    const clients = await projectSyncClients({ db, organizationId, environment: env })
    const nextAttempts = operation.attempts + 1

    if (operation.operation === "drive_folder_rename") {
      await renameDriveFolder({ db, projectId: input.projectId, project, clients, user })
    } else if (operation.operation === "tracker_row_update") {
      await updateTrackerRows({
        db,
        organizationId,
        projectId: input.projectId,
        project,
        clients,
        previousProjectNumber: numbers.previousProjectNumber,
      })
    } else {
      return { result: { success: false, error: "Unsupported synchronization operation." }, revalidate: false }
    }

    await updateProjectProfileSyncOperations(db, eq(projectProfileSyncOperations.id, operation.id), {
      status: "completed",
      error: null,
      attempts: nextAttempts,
      attemptedAt,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await recordProjectAudit(db, {
      organizationId,
      projectId: input.projectId,
      actorUserId: user.id,
      eventType: "project_profile_sync_completed",
      entityType: "project_profile_sync_operation",
      entityId: operation.id,
      beforeJson: JSON.stringify(null),
      afterJson: JSON.stringify({ operation: operation.operation }),
      createdAt: new Date().toISOString(),
    })
    return { result: { success: true }, revalidate: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "External synchronization failed."
    try {
      const { db } = await projectProfileContext(input.projectId, "update")
      await updateProjectProfileSyncOperations(db, eq(projectProfileSyncOperations.id, input.operationId), {
        status: "failed",
        error: errorMessage.slice(0, 1000),
        attempts: sql`${projectProfileSyncOperations.attempts} + 1`,
        attemptedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (updateError) {
      console.error("Unable to record project profile synchronization failure", updateError)
    }
    console.error("Unable to synchronize project profile", error)
    return { result: { success: false, error: errorMessage }, revalidate: true }
  }
}
