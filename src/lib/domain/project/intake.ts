/**
 * Project intake: numbering, client and assignee resolution, and the project
 * rows a new intake writes. Callers check access first; every read is scoped
 * to the caller's organization.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm"

import {
  customers,
  internalContacts,
  organizationMembers,
  projectExternalLinks,
  projectNumberReservations,
  projectNumberRetirements,
  projects,
  users,
} from "@/db/schema"
import {
  insertCustomerStatement,
  insertInternalContactStatement,
  insertProjectContactStatement,
  updateCustomerByIdStatement,
} from "@/lib/domain/contacts/store"
import type { ProjectDriveProvisioningResult } from "@/lib/google/project-drive-provisioning"
import { projectDriveTemplateFolderId } from "@/lib/google/project-drive-provisioning"
import {
  allocateProjectNumber,
  PROJECT_REGISTRY_DESTINATION,
  type ProjectIntakeDepartment,
  type ProjectTrackerLayout,
  type ProjectTrackingDestination,
} from "@/lib/google/project-intake-tracker"
import type { ProjectDuplicateCandidate } from "@/lib/project-duplicate-detector"
import { findProspectiveProjectDuplicates } from "@/lib/project-duplicate-store"
import { sageClientLinkReviewIds } from "@/lib/sage/client-link-review"
import type { SageClientStatusId, SageJobTypeId } from "@/lib/sage/client-project-write"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"

import type { CreateProjectIntakeInput } from "./intake-types"
import type { SageClientJobPayload } from "./rules"
import { spreadsheetUrl } from "./intake-trackers"
import { insertProjectNumberReservationStatement } from "./numbering-store"
import { insertProjectDuplicateDecisionStatement } from "./registry-store"
import {
  candidateExistingProjectId,
  customerNeedsSageStatus,
  intakeAssigneeName,
  joinedAddress,
  orderedProjectPair,
  sageClientJobPayload,
  slugPart,
  unconfirmedDuplicateCandidates,
} from "./rules"
import {
  insertProjectExternalLinkStatement,
  insertProjectMemberStatement,
  insertProjectStatement,
  updateProjectExternalLinksStatement,
  updateProjectsStatement,
  type Statement,
} from "./store"

type SheetRows = ReadonlyArray<ReadonlyArray<unknown>>
type Customer = typeof customers.$inferSelect
type Failure = { readonly ok: false; readonly error: string }

/**
 * The next department number: the sheets' numbers, every reservation and
 * retirement, the department tracker, and every Compass project number in the
 * organization are all taken.
 */
export async function allocateIntakeProjectNumber(
  db: Db,
  input: {
    readonly organizationId: string
    readonly department: ProjectIntakeDepartment
    readonly streetNumber: string | null
    readonly registryRows: SheetRows
    readonly registryLayout: ProjectTrackerLayout
    readonly departmentRows: SheetRows
    readonly departmentLayout: ProjectTrackerLayout
  },
): Promise<string> {
  const { organizationId, department, departmentLayout } = input
  const [reservations, retirements] = await Promise.all([
    db.select({ projectNumber: projectNumberReservations.projectNumber }).from(projectNumberReservations).where(and(eq(projectNumberReservations.organizationId, organizationId), eq(projectNumberReservations.department, department))),
    db.select({ projectNumber: projectNumberRetirements.projectNumber }).from(projectNumberRetirements).where(and(eq(projectNumberRetirements.organizationId, organizationId), eq(projectNumberRetirements.department, department))),
  ])
  const compassProjectNumbers = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
  return allocateProjectNumber({
    department,
    streetNumber: input.streetNumber,
    rows: input.registryRows,
    layout: input.registryLayout,
    reservedProjectNumbers: reservations.map(
      (reservation) => reservation.projectNumber
    ).concat(
      retirements.map((retirement) => retirement.projectNumber),
      input.departmentRows.slice(departmentLayout.headerRowNumber).flatMap((row) => {
        const value = row[departmentLayout.projectNumberColumn]
        return typeof value === "string" && value.trim() ? [value] : []
      }),
      compassProjectNumbers.flatMap((project) =>
        project.projectNumber ? [project.projectNumber] : []
      )
    ),
  })
}

export async function projectNumberExists(
  db: Db,
  organizationId: string,
  projectNumber: string,
): Promise<boolean> {
  const duplicate = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(projects.projectNumber, projectNumber)
      )
    )
    .limit(1)
  return Boolean(duplicate[0])
}

/**
 * Existing projects that look like the new one, and those the person has not
 * yet confirmed are different (registry visibility rules apply in the store).
 */
export async function prospectiveDuplicates(
  db: Db,
  organizationId: string,
  identity: {
    readonly projectNumber: string | null
    readonly name: string
    readonly clientName: string
    readonly address: string | null
  },
  confirmedDistinctProjectIds: readonly string[] | undefined,
): Promise<{
  readonly candidates: readonly ProjectDuplicateCandidate[]
  readonly unconfirmed: readonly ProjectDuplicateCandidate[]
}> {
  const candidates = await findProspectiveProjectDuplicates(db, organizationId, {
    ...identity,
    sageJobId: null,
    sageJobNumber: null,
    googleDriveFolderId: null,
    buildertrendProjectId: null,
  })
  return { candidates, unconfirmed: unconfirmedDuplicateCandidates(candidates, confirmedDistinctProjectIds) }
}

/** The exact directory client an intake may use, or why it cannot. */
export async function resolveIntakeCustomer(
  db: Db,
  input: {
    readonly organizationId: string
    readonly selectedCustomerId: string | null
    readonly contactEmail: string | null
    readonly clientName: string
    readonly sageClientStatusId: SageClientStatusId
  },
): Promise<{ readonly ok: true; readonly customer: Customer | null } | Failure> {
  const { organizationId, selectedCustomerId, clientName } = input
  const customerEmail = cleanText(input.contactEmail)?.toLowerCase() ?? null
  const customerMatches = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        isNull(customers.mergedIntoCustomerId),
        selectedCustomerId
          ? eq(customers.id, selectedCustomerId)
          : customerEmail
          ? or(
              sql`lower(trim(${customers.email})) = ${customerEmail}`,
              sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
            )
          : sql`lower(trim(${customers.name})) = ${clientName.toLowerCase()}`
      )
    )
    .limit(2)
  if (selectedCustomerId && customerMatches.length === 0) {
    return { ok: false, error: "The selected client is no longer in this directory. Refresh and choose it again." }
  }
  if (customerMatches.length > 1) {
    return {
      ok: false,
      error: "More than one client directory record matches this intake. Select or reconcile the exact client before creating the project.",
    }
  }
  if (!selectedCustomerId && customerMatches.length > 0) {
    return {
      ok: false,
      error: "This client already exists in Contacts. Choose the exact client from the directory list before creating the project.",
    }
  }
  const customerMatch = selectedCustomerId ? customerMatches[0] ?? null : null
  const sameNameCustomers = customerMatch
    ? await db.select({
        id: customers.id,
        name: customers.name,
        sageClientId: customers.sageClientId,
        sageClientNumber: customers.sageClientNumber,
      }).from(customers).where(and(
        eq(customers.organizationId, organizationId),
        isNull(customers.mergedIntoCustomerId),
        sql`lower(trim(${customers.name})) = ${customerMatch.name.trim().toLowerCase()}`,
      ))
    : []
  if (customerMatch && sageClientLinkReviewIds(sameNameCustomers).has(customerMatch.id)) {
    return {
      ok: false,
      error: "This client has an incomplete or same-name Sage link candidate. Reconcile the exact Sage ID and number in Contacts before creating the project.",
    }
  }
  if (customerMatch?.sageClientStatusId != null && customerMatch.sageClientStatusId !== input.sageClientStatusId) {
    return {
      ok: false,
      error: "The selected client has a different Sage status. Use its directory status or reconcile it in Contacts before creating the project.",
    }
  }
  return { ok: true, customer: customerMatch }
}

type IntakeAssignee = {
  readonly id: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
  readonly phone: string | null
}

type AssigneeDirectory = {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  readonly active: boolean
}

type ResolvedIntakeAssignee = {
  readonly ok: true
  readonly assignedTo: string | null
  readonly assignee: IntakeAssignee | null
  readonly projectManagerName: string | null
  readonly assigneeDirectory: AssigneeDirectory | null
  readonly assigneeDirectoryId: string | null
}

/** Matches the typed project manager to an active team member by name. */
export async function resolveIntakeAssignee(
  db: Db,
  input: { readonly organizationId: string; readonly assignedTo: string | null },
): Promise<ResolvedIntakeAssignee | Failure> {
  const { organizationId } = input
  const assignedTo = cleanText(input.assignedTo)
  const assigneeRows = assignedTo
    ? await db
        .select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(users.isActive, true)
          )
        )
    : []
  const assignee = assignedTo
    ? assigneeRows.find(
        (candidate) =>
          intakeAssigneeName(candidate).toLowerCase() === assignedTo.toLowerCase()
      ) ?? null
    : null
  const projectManagerName = assignee ? intakeAssigneeName(assignee) : assignedTo
  const assigneeDirectory = assignee
    ? await db
        .select({
          id: internalContacts.id,
          name: internalContacts.name,
          email: internalContacts.email,
          phone: internalContacts.phone,
          active: internalContacts.active,
        })
        .from(internalContacts)
        .where(
          and(
            eq(internalContacts.organizationId, organizationId),
            eq(internalContacts.userId, assignee.id)
          )
        )
        .get()
    : null
  if (assigneeDirectory && !assigneeDirectory.active) {
    return { ok: false, error: "The assigned staff member is inactive in the internal contact directory." }
  }
  return {
    ok: true,
    assignedTo,
    assignee,
    projectManagerName,
    assigneeDirectory: assigneeDirectory ?? null,
    assigneeDirectoryId: assignee ? assigneeDirectory?.id ?? crypto.randomUUID() : null,
  }
}

type IntakeCustomerValues = {
  readonly id: string
  readonly organizationId: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly notes: string | null
  readonly sageClientStatusId: SageClientStatusId
  readonly createdAt: string
  readonly updatedAt: string
}

/** The client the intake writes; an existing directory client stays canonical. */
export function intakeCustomerValues(input: {
  readonly customerId: string
  readonly organizationId: string
  readonly customerMatch: Customer | null
  readonly clientName: string
  readonly intake: CreateProjectIntakeInput
  readonly sageClientStatusId: SageClientStatusId
  readonly now: string
}): IntakeCustomerValues {
  const { customerMatch, intake } = input
  return {
    id: input.customerId,
    organizationId: input.organizationId,
    name: customerMatch?.name ?? input.clientName,
    company: customerMatch ? customerMatch.company : cleanText(intake.companyName),
    email: customerMatch ? customerMatch.email : cleanText(intake.contactEmail),
    phone: customerMatch ? customerMatch.phone : cleanText(intake.contactPhone),
    address: customerMatch
      ? customerMatch.address
      : cleanText(intake.billingAddress) ?? joinedAddress(intake),
    notes: customerMatch ? customerMatch.notes : cleanText(intake.notes),
    sageClientStatusId: input.sageClientStatusId,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

type IntakeRecordIds = {
  readonly projectId: string
  readonly ownerContactId: string
  readonly internalContactId: string | null
  readonly registryLinkId: string
  readonly departmentTrackerLinkId: string
  readonly driveLinkId: string
  readonly sageLinkId: string
}

/** Every id an intake creates, including its queued operations. */
export type IntakeIds = IntakeRecordIds & {
  readonly operationId: string
  readonly sageOperationId: string
  readonly sageWriteOperationId: string
}

export function newIntakeIds(projectNumber: string, hasAssignedTo: boolean): IntakeIds {
  return {
    projectId: `proj-${slugPart(projectNumber)}-${crypto.randomUUID().slice(0, 8)}`,
    ownerContactId: crypto.randomUUID(),
    internalContactId: hasAssignedTo ? crypto.randomUUID() : null,
    operationId: crypto.randomUUID(),
    registryLinkId: crypto.randomUUID(),
    departmentTrackerLinkId: crypto.randomUUID(),
    driveLinkId: crypto.randomUUID(),
    sageLinkId: crypto.randomUUID(),
    sageOperationId: crypto.randomUUID(),
    sageWriteOperationId: crypto.randomUUID(),
  }
}

/**
 * The project, client, contact, member, number reservation and link rows of
 * an intake, in the order the intake batch writes them. The batch is atomic,
 * and the number reservation's unique index makes a racing intake fail.
 */
export function intakeRecordStatements(
  db: Db,
  input: {
    readonly ids: IntakeRecordIds
    readonly organizationId: string
    readonly projectNumber: string
    readonly sequence: number
    readonly department: ProjectIntakeDepartment
    readonly projectName: string
    readonly address: string | null
    readonly driveFolderName: string
    readonly departmentDestination: ProjectTrackingDestination
    readonly jobStatus: { readonly id: string; readonly label: string }
    readonly sageJobTypeName: string
    readonly customerValues: IntakeCustomerValues
    readonly customerMatch: Customer | null
    readonly assignee: ResolvedIntakeAssignee
    readonly now: string
  },
): readonly [Statement, ...Statement[]] {
  const { ids, organizationId, projectNumber, department, customerValues, customerMatch, now } = input
  const { projectId } = ids
  const { assignedTo, assignee, assigneeDirectory, assigneeDirectoryId, projectManagerName } = input.assignee
  return [
    insertProjectStatement(db, {
      id: projectId,
      organizationId,
      projectNumber,
      department,
      name: input.projectName,
      status: "OPEN",
      address: input.address,
      clientName: customerValues.name,
      clientStatus: "customer",
      jobStatusId: input.jobStatus.id,
      sageJobStatusName: input.jobStatus.label,
      sageJobTypeName: input.sageJobTypeName,
      projectManager: projectManagerName,
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      createdAt: now,
      updatedAt: now,
    }),
    ...(assignee && assigneeDirectoryId && !assigneeDirectory
      ? [insertInternalContactStatement(db, {
          id: assigneeDirectoryId,
          organizationId,
          userId: assignee.id,
          name: projectManagerName ?? assignee.email,
          email: assignee.email,
          phone: assignee.phone,
          sourceSystem: "compass_user",
          sourceRecordId: assignee.id,
          active: true,
          syncStatus: "manual",
          createdAt: now,
          updatedAt: now,
        })]
      : []),
    ...(!customerMatch
      ? [insertCustomerStatement(db, customerValues)]
      : customerNeedsSageStatus(customerMatch)
        ? [updateCustomerByIdStatement(db, { customerId: customerValues.id, values: { sageClientStatusId: customerValues.sageClientStatusId, updatedAt: now } })]
        : []),
    insertProjectContactStatement(db, {
      id: ids.ownerContactId,
      projectId,
      contactType: "owner",
      sourceSystem: "customer_directory",
      sourceRecordId: customerValues.id,
      sourceEntityType: "customer",
      sourceEntityId: customerValues.id,
      displayName: customerValues.name,
      companyName: customerValues.company,
      role: "Owner / Client",
      email: customerValues.email,
      phone: customerValues.phone,
      address: customerValues.address,
      notes: null,
      ownerPortalVisible: true,
      subVendorPortalVisible: false,
      internalVisible: true,
      primaryContact: true,
      active: true,
      sortOrder: 100,
      syncStatus: "manual",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
    ...(assignedTo && ids.internalContactId
      ? [
          insertProjectContactStatement(db, {
            id: ids.internalContactId,
            projectId,
            contactType: "internal",
            sourceSystem: assignee ? "internal_directory" : "compass_project_intake",
            sourceRecordId: assigneeDirectoryId ?? projectId,
            sourceEntityType: assignee ? "internal_contact" : "manual",
            sourceEntityId: assigneeDirectoryId,
            internalContactId: assigneeDirectoryId,
            displayName: assigneeDirectory?.name ?? projectManagerName ?? assignedTo,
            companyName: null,
            role: "Project manager",
            email: assigneeDirectory?.email ?? assignee?.email ?? null,
            phone: assigneeDirectory?.phone ?? assignee?.phone ?? null,
            address: null,
            notes: assignee
              ? null
              : "Typed project intake assignment; match this contact to an active team member when available.",
            ownerPortalVisible: true,
            subVendorPortalVisible: true,
            internalVisible: true,
            primaryContact: true,
            active: true,
            sortOrder: 200,
            syncStatus: assignee ? "synced" : "manual",
            lastSyncedAt: assignee ? now : null,
            createdAt: now,
            updatedAt: now,
          }),
        ]
      : []),
    ...(assignee
      ? [
          insertProjectMemberStatement(db, {
            id: crypto.randomUUID(),
            projectId,
            userId: assignee.id,
            role: "project-manager",
            assignedAt: now,
          }),
        ]
      : []),
    insertProjectNumberReservationStatement(db, {
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      department,
      sequence: input.sequence,
      projectNumber,
      createdAt: now,
    }),
    ...intakeLinkStatements(db, input),
  ]
}

function intakeLinkStatements(
  db: Db,
  input: {
    readonly ids: IntakeRecordIds
    readonly projectNumber: string
    readonly department: ProjectIntakeDepartment
    readonly driveFolderName: string
    readonly departmentDestination: ProjectTrackingDestination
    readonly now: string
  },
): readonly Statement[] {
  const { ids, projectNumber, department, departmentDestination, now } = input
  const { projectId } = ids
  return [
    insertProjectExternalLinkStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      system: "compass",
      label: "Compass project",
      externalId: projectId,
      externalNumber: projectNumber,
      externalUrl: `/dashboard/projects/${projectId}`,
      syncDirection: "bidirectional",
      syncStatus: "mapped",
      metadata: JSON.stringify({ department }),
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectExternalLinkStatement(db, {
      id: ids.driveLinkId,
      projectId,
      system: "google_drive",
      label: "Project Drive folder",
      externalId: null,
      externalNumber: null,
      externalUrl: null,
      syncDirection: "read_write",
      syncStatus: "pending",
      metadata: JSON.stringify({
        department,
        folderName: input.driveFolderName,
      }),
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectExternalLinkStatement(db, {
      id: ids.sageLinkId,
      projectId,
      system: "sage",
      label: "Sage job",
      externalId: null,
      externalNumber: projectNumber,
      externalUrl: null,
      syncDirection: "bidirectional",
      syncStatus: "unmapped",
      metadata: JSON.stringify({
        pendingProjectNumber: projectNumber,
        source: "compass_project_intake",
      }),
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectExternalLinkStatement(db, {
      id: ids.registryLinkId,
      projectId,
      system: "google_project_registry",
      label: PROJECT_REGISTRY_DESTINATION.workbookTitle,
      externalId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      externalNumber: projectNumber,
      externalUrl: spreadsheetUrl(PROJECT_REGISTRY_DESTINATION.spreadsheetId),
      syncDirection: "bidirectional",
      syncStatus: "pending",
      metadata: JSON.stringify({
        sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
        projectNumber,
      }),
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectExternalLinkStatement(db, {
      id: ids.departmentTrackerLinkId,
      projectId,
      system: "google_department_tracker",
      label: departmentDestination.workbookTitle,
      externalId: departmentDestination.spreadsheetId,
      externalNumber: projectNumber,
      externalUrl: spreadsheetUrl(departmentDestination.spreadsheetId),
      syncDirection: "bidirectional",
      syncStatus: "pending",
      metadata: JSON.stringify({
        sheet: departmentDestination.sheetTitle,
        department,
        projectNumber,
      }),
      createdAt: now,
      updatedAt: now,
    }),
  ]
}

/**
 * Records every prospective duplicate the person confirmed as a different
 * project, so the registry does not raise the pair again.
 */
export function confirmedDistinctDecisionStatements(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly candidates: readonly ProjectDuplicateCandidate[]
    readonly resolvedByUserId: string
    readonly now: string
  },
): readonly Statement[] {
  const { organizationId, projectId, now } = input
  return input.candidates.map((candidate) => {
    const [projectAId, projectBId] = orderedProjectPair(
      projectId,
      candidateExistingProjectId(candidate),
    )
    return insertProjectDuplicateDecisionStatement(db, {
      id: crypto.randomUUID(),
      organizationId,
      projectAId,
      projectBId,
      status: "not_duplicate",
      keptProjectId: null,
      removedProjectId: null,
      score: candidate.score,
      reasonsJson: JSON.stringify(candidate.reasons),
      removedProjectSnapshotJson: null,
      resolvedByUserId: input.resolvedByUserId,
      resolvedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  })
}

/** The project's Drive folder id and its Drive link receipt after intake provisioning. */
export function intakeDriveReceiptStatements(
  db: Db,
  input: {
    readonly projectId: string
    readonly driveLinkId: string
    readonly department: ProjectIntakeDepartment
    readonly drive: ProjectDriveProvisioningResult
    readonly syncedAt: string
  },
): readonly [Statement, Statement] {
  const { drive, syncedAt } = input
  return [
    updateProjectsStatement(db, eq(projects.id, input.projectId), {
      googleDriveFolderId: drive.folderId,
      updatedAt: syncedAt,
    }),
    updateProjectExternalLinksStatement(db, eq(projectExternalLinks.id, input.driveLinkId), {
      externalId: drive.folderId,
      externalUrl: drive.folderUrl,
      syncStatus: "mapped",
      lastSyncedAt: syncedAt,
      metadata: JSON.stringify({
        department: input.department,
        folderName: drive.folderName,
        parentFolderId: drive.parentFolderId,
        templateFolderId: projectDriveTemplateFolderId(input.department),
        childFolderNames: drive.childFolderNames,
        copiedFileCount: drive.copiedFileCount,
      }),
      updatedAt: syncedAt,
    }),
  ]
}

/** The Sage client/job handoff for an intake: the directory client and the new job. */
export function intakeSageWritePayload(input: {
  readonly customerValues: IntakeCustomerValues
  readonly customerMatch: Customer | null
  readonly intake: CreateProjectIntakeInput
  readonly projectId: string
  readonly projectNumber: string
  readonly projectName: string
  readonly jobStatusLabel: string
  readonly jobType: SageJobTypeId
}): SageClientJobPayload {
  const { customerValues, customerMatch, intake } = input
  return sageClientJobPayload(
    {
      compassCustomerId: customerValues.id,
      sageClientId: customerMatch?.sageClientId ?? null,
      sageClientNumber: customerMatch?.sageClientNumber ?? null,
      name: customerValues.name,
      shortNameSource: customerValues.company ?? customerValues.name,
      company: customerValues.company,
      email: customerValues.email,
      phone: customerValues.phone,
      address: customerValues.address,
      billingAddress: customerMatch ? null : cleanText(intake.billingAddress),
      notes: customerValues.notes,
      statusId: customerValues.sageClientStatusId,
    },
    {
      compassProjectId: input.projectId,
      compassProjectNumber: input.projectNumber,
      projectName: input.projectName,
      address: joinedAddress(intake),
      statusName: input.jobStatusLabel,
      jobType: input.jobType,
    },
  )
}
