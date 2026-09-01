"use server"

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  customers,
  organizationMembers,
  projectAccessInvitations,
  projectContacts,
  projectContactSourceLinks,
  projectProfileSyncOperations,
  projectMembers,
  projects,
  sageCostCodes,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  activeDirectoryIdentityKeys,
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
  type ContactIdentityFields,
} from "@/lib/contact-identity-ownership"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requirePermission } from "@/lib/permissions"
import {
  projectContactAccessStatus,
  type ProjectContactAccessStatus,
  type ProjectContactInvitationSnapshot,
} from "@/lib/project-contact-access-status"
import { resolveProjectContactIdentity } from "@/lib/project-contact-directory-identity"
import { canViewHistoricalProjectContacts } from "@/lib/project-contact-display"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectContactType =
  | "owner"
  | "supplier"
  | "subcontractor"
  | "internal"

export type ProjectContactAudience = "internal" | "owner" | "sub_vendor"

export type ProjectContactItem = {
  readonly id: string
  readonly contactType: ProjectContactType
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly vendorId: string | null
  readonly vendorContactId: string | null
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
  readonly primaryCostCode: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly notes: string | null
  readonly ownerPortalVisible: boolean
  readonly subVendorPortalVisible: boolean
  readonly internalVisible: boolean
  readonly primaryContact: boolean
  readonly active: boolean
  readonly syncStatus: string
  readonly lastSyncedAt: string | null
  readonly accessStatus: ProjectContactAccessStatus
  readonly identityManagedByActiveUser: boolean
}

export type ProjectContactGroup = {
  readonly contactType: ProjectContactType
  readonly label: string
  readonly count: number
  readonly contacts: readonly ProjectContactItem[]
}

export type ProjectContactsSummary = {
  readonly audience: ProjectContactAudience
  readonly totalCount: number
  readonly ownerCount: number
  readonly supplierCount: number
  readonly subcontractorCount: number
  readonly internalCount: number
  readonly visibleToOwnerCount: number
  readonly visibleToSubVendorCount: number
  readonly matchedSourceCount: number
  readonly unmatchedSourceCount: number
  readonly reviewSourceCount: number
  readonly pendingAssignmentSourceCount: number
  readonly approvedSourceCount: number
  readonly groups: readonly ProjectContactGroup[]
  readonly csiGroups: readonly ProjectContactCsiGroup[]
  readonly allContacts: readonly ProjectContactItem[]
  readonly historicalContacts: readonly ProjectContactItem[]
}

export type ProjectContactsSummaryOptions = {
  readonly includeHistorical?: boolean
}

export type ProjectContactCsiGroup = {
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly count: number
  readonly contacts: readonly ProjectContactItem[]
}

export type ProjectContactSourceLinkItem = {
  readonly id: string
  readonly projectId: string
  readonly projectContactId: string | null
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordId: string
  readonly sourceRecordNumber: string | null
  readonly sourceLabel: string
  readonly sourceName: string
  readonly matchStatus: string
  readonly matchConfidence: number
  readonly matchReason: string | null
  readonly contactDisplayName: string | null
  readonly contactType: ProjectContactType | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
}

export type IndependentContactItem = {
  readonly id: string
  readonly name: string
  readonly contactType: ProjectContactType
  readonly category: string
  readonly sourceSystem: string
  readonly syncStatus: string
}

export type ProjectContactMatchReview = {
  readonly projectId: string
  readonly contacts: readonly ProjectContactItem[]
  readonly independentContacts: readonly IndependentContactItem[]
  readonly links: readonly ProjectContactSourceLinkItem[]
  readonly matchedCount: number
  readonly reviewCount: number
  readonly unmatchedCount: number
  readonly pendingAssignmentCount: number
  readonly approvedCount: number
  readonly ignoredCount: number
}

export type ContactMatchResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type ProjectTaskAssigneeOption = {
  readonly id: string
  readonly label: string
  readonly name: string
  readonly companyName: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly contactType: ProjectContactType
  readonly source: "project" | "directory"
  readonly projectContactId: string | null
  readonly directoryContactId: string | null
  readonly projectAccess: boolean
}

export type ProjectTaskAssigneeOptions = {
  readonly projectContacts: readonly ProjectTaskAssigneeOption[]
  readonly directoryContacts: readonly ProjectTaskAssigneeOption[]
}

export type AddTaskAssigneeContactResult =
  | { readonly success: true; readonly contact: ProjectTaskAssigneeOption }
  | { readonly success: false; readonly error: string }

export type ProjectContactDirectorySource = "customer" | "vendor" | "team"

export type ProjectContactDirectoryOption = {
  readonly id: string
  readonly sourceType: ProjectContactDirectorySource
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly suggestedContactType: ProjectContactType
  readonly identityManagedByActiveUser: boolean
  readonly vendorContacts: readonly ProjectVendorContactOption[]
}

export type ProjectVendorContactOption = {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly isPrimary: boolean
  readonly identityManagedByActiveUser: boolean
}

export type ProjectContactDivisionOption = {
  readonly value: string
  readonly label: string
  readonly name: string
}

export type ProjectContactCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionName: string
}

export type ProjectContactSageOptions = {
  readonly divisions: readonly ProjectContactDivisionOption[]
  readonly costCodes: readonly ProjectContactCostCodeOption[]
}

export type ProjectContactMutationInput = {
  readonly projectId: string
  readonly contactId: string | null
  readonly directorySourceType: ProjectContactDirectorySource | null
  readonly directorySourceId: string | null
  readonly vendorId: string | null
  readonly vendorContactId: string | null
  readonly contactType: ProjectContactType
  readonly displayName: string
  readonly companyName: string
  readonly role: string
  readonly trade: string
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly primaryCostCode: string
  readonly email: string
  readonly phone: string
  readonly address: string
  readonly notes: string
  readonly ownerPortalVisible: boolean
  readonly subVendorPortalVisible: boolean
  readonly internalVisible: boolean
  readonly primaryContact: boolean
}

export type ProjectContactMutationResult =
  | {
      readonly success: true
      readonly contactId: string
      readonly warning?: string
    }
  | { readonly success: false; readonly error: string }

const CONTACT_TYPES: readonly ProjectContactType[] = [
  "owner",
  "supplier",
  "subcontractor",
  "internal",
]

function contactTypeLabel(type: ProjectContactType): string {
  switch (type) {
    case "owner":
      return "Owners"
    case "supplier":
      return "Suppliers"
    case "subcontractor":
      return "Subcontractors"
    case "internal":
      return "Internal"
  }
}

function environmentString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null) return null
  const value = Reflect.get(env, key)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function toContactType(value: string): ProjectContactType {
  if (value === "owner") return "owner"
  if (value === "supplier") return "supplier"
  if (value === "subcontractor") return "subcontractor"
  return "internal"
}

function toWritableContactType(value: string): ProjectContactType {
  if (value === "owner") return "owner"
  if (value === "supplier") return "supplier"
  if (value === "internal") return "internal"
  return "subcontractor"
}

function nullableInput(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validContactType(value: string): value is ProjectContactType {
  return CONTACT_TYPES.some((contactType) => contactType === value)
}

function vendorCategoryToContactType(category: string): ProjectContactType {
  const lower = category.toLowerCase()
  if (lower.includes("internal")) return "internal"
  if (lower.includes("supplier") || lower.includes("miscellaneous")) {
    return "supplier"
  }
  return "subcontractor"
}

function isDirectoryAssignable(category: string): boolean {
  const lower = category.toLowerCase()
  return !lower.includes("bank") && !lower.includes("lender")
}

async function verifyProjectAccess(
  projectId: string,
  action: "read" | "update" = "read"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", action)
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

function requireStringField(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName)
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`)
  }

  return value.trim()
}

function requireLinkIds(formData: FormData): readonly string[] {
  const values = formData
    .getAll("linkId")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const linkIds = Array.from(new Set(values))

  if (linkIds.length === 0) {
    throw new Error("linkId is required")
  }

  return linkIds
}

function toContactItem(
  row: typeof projectContacts.$inferSelect,
  accessStatus: ProjectContactAccessStatus = "not_invited",
  directoryIdentityManaged = false
): ProjectContactItem {
  return {
    id: row.id,
    contactType: toContactType(row.contactType),
    sourceSystem: row.sourceSystem,
    sourceRecordId: row.sourceRecordId,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    vendorId: row.vendorId,
    vendorContactId: row.vendorContactId,
    displayName: row.displayName,
    companyName: row.companyName,
    role: row.role,
    trade: row.trade,
    csiDivision: row.csiDivision,
    csiDivisionName: row.csiDivisionName,
    primaryCostCode: row.primaryCostCode,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    ownerPortalVisible: row.ownerPortalVisible,
    subVendorPortalVisible: row.subVendorPortalVisible,
    internalVisible: row.internalVisible,
    primaryContact: row.primaryContact,
    active: row.active,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt,
    accessStatus,
    identityManagedByActiveUser:
      accessStatus === "active" || directoryIdentityManaged,
  }
}

function buildCsiGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactCsiGroup[] {
  const groups = new Map<string, ProjectContactItem[]>()

  for (const contact of contacts) {
    if (!contact.csiDivision || !contact.csiDivisionName) continue

    const key = `${contact.csiDivision}|${contact.csiDivisionName}`
    const existing = groups.get(key) ?? []
    existing.push(contact)
    groups.set(key, existing)
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const [csiDivision, csiDivisionName] = key.split("|")
    return {
      csiDivision,
      csiDivisionName,
      count: items.length,
      contacts: items,
    }
  })
}

function buildGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactGroup[] {
  return CONTACT_TYPES.map((contactType) => {
    const items = contacts.filter((contact) => contact.contactType === contactType)
    return {
      contactType,
      label: contactTypeLabel(contactType),
      count: items.length,
      contacts: items,
    }
  })
}

function toSourceLinkItem(
  row: typeof projectContactSourceLinks.$inferSelect,
  contact: ProjectContactItem | undefined
): ProjectContactSourceLinkItem {
  return {
    id: row.id,
    projectId: row.projectId,
    projectContactId: row.projectContactId,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    sourceRecordNumber: row.sourceRecordNumber,
    sourceLabel: row.sourceLabel,
    sourceName: row.sourceName,
    matchStatus: row.matchStatus,
    matchConfidence: row.matchConfidence,
    matchReason: row.matchReason,
    contactDisplayName: contact?.displayName ?? null,
    contactType: contact?.contactType ?? null,
    csiDivision: contact?.csiDivision ?? null,
    csiDivisionName: contact?.csiDivisionName ?? null,
  }
}

function revalidateContactPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/contacts`)
  revalidatePath(`/dashboard/projects/${projectId}/contacts/review`)
  revalidatePath(`/dashboard/projects/${projectId}/information`)
  revalidatePath(`/dashboard/projects/${projectId}/rfis`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
}

async function queueProjectContactTrackerRefresh(input: {
  readonly db: Awaited<ReturnType<typeof getDb>>
  readonly organizationId: string
  readonly projectId: string
}): Promise<void> {
  const [project] = await input.db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, input.organizationId),
      ),
    )
    .limit(1)
  if (!project?.projectNumber) return

  const now = new Date().toISOString()
  await input.db.insert(projectProfileSyncOperations).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    operation: "tracker_row_update",
    status: "pending",
    payloadJson: JSON.stringify({
      previousProjectNumber: project.projectNumber,
      projectNumber: project.projectNumber,
    }),
    error: null,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

function sourceIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
}

function normalizeDirectoryKey(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function projectContactToTaskAssigneeOption(
  contact: ProjectContactItem
): ProjectTaskAssigneeOption {
  const companySuffix =
    contact.companyName && contact.companyName !== contact.displayName
      ? ` - ${contact.companyName}`
      : ""

  return {
    id: `project:${contact.id}`,
    label: `${contact.displayName}${companySuffix}`,
    name: contact.displayName,
    companyName: contact.companyName,
    email: contact.email,
    phone: contact.phone,
    contactType: contact.contactType,
    source: "project",
    projectContactId: contact.id,
    directoryContactId: null,
    projectAccess: true,
  }
}

function directoryContactToTaskAssigneeOption(input: {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly email: string | null
  readonly phone: string | null
}): ProjectTaskAssigneeOption {
  const contactType = vendorCategoryToContactType(input.category)

  return {
    id: `directory:${input.id}`,
    label: `${input.name} - Directory`,
    name: input.name,
    companyName: input.name,
    email: input.email,
    phone: input.phone,
    contactType,
    source: "directory",
    projectContactId: null,
    directoryContactId: input.id,
    projectAccess: false,
  }
}

function organizationUserToTaskAssigneeOption(input: {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
}): ProjectTaskAssigneeOption {
  const fullName = [input.firstName, input.lastName]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(" ")
  const name = input.displayName?.trim() || fullName || input.email

  return {
    id: `team:${input.id}`,
    label: name,
    name,
    companyName: null,
    email: input.email,
    phone: null,
    contactType: "internal",
    source: "project",
    projectContactId: null,
    directoryContactId: null,
    projectAccess: true,
  }
}

export async function getProjectContactsSummary(
  projectId: string,
  audience: ProjectContactAudience = "internal",
  options: ProjectContactsSummaryOptions = {}
): Promise<ProjectContactsSummary> {
  const db = await verifyProjectAccess(projectId)

  const visibilityWhere =
    audience === "owner"
      ? and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true),
          eq(projectContacts.ownerPortalVisible, true)
        )
      : audience === "sub_vendor"
        ? and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true),
            eq(projectContacts.subVendorPortalVisible, true)
          )
        : and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true),
            or(
              eq(projectContacts.internalVisible, true),
              eq(projectContacts.ownerPortalVisible, true),
              eq(projectContacts.subVendorPortalVisible, true)
            )
          )

  const historicalWhere = and(
    eq(projectContacts.projectId, projectId),
    eq(projectContacts.active, false),
    eq(projectContacts.contactType, "internal"),
    eq(projectContacts.sourceSystem, "buildertrend"),
    // Inactive imports also include superseded duplicates. Only surface rows
    // that the cutover explicitly classified as historical staff records.
    sql`case
      when json_valid(${projectContacts.notes}) = 1
        then json_extract(${projectContacts.notes}, '$.formerEmployeeStatus')
      else null
    end in ('former_employee', 'former_employee_or_review')`,
    sql`not exists (
      select 1
      from project_contacts active_contact
      where active_contact.project_id = ${projectContacts.projectId}
        and active_contact.active = 1
        and active_contact.contact_type = 'internal'
        and (
          (
            ${projectContacts.sourceEntityId} is not null
            and active_contact.source_entity_id = ${projectContacts.sourceEntityId}
          )
          or (
            trim(coalesce(${projectContacts.email}, '')) <> ''
            and lower(trim(active_contact.email)) = lower(trim(${projectContacts.email}))
          )
        )
    )`
  )
  const queryWhere =
    options.includeHistorical &&
    audience === "internal" &&
    canViewHistoricalProjectContacts((await requireAuth()).role)
      ? or(visibilityWhere, historicalWhere)
      : visibilityWhere

  const projectRow = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!projectRow?.organizationId) throw new Error("Project not found")
  const organizationId = projectRow.organizationId
  const directoryRows = await db
    .select({
      contact: projectContacts,
      customer: {
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
      },
      vendor: {
        email: vendors.email,
        phone: vendors.phone,
        address: vendors.address,
      },
      vendorContact: {
        email: vendorContacts.email,
        phone: vendorContacts.phone,
      },
      teamMember: {
        email: users.email,
        phone: users.phone,
        address: users.address,
      },
    })
    .from(projectContacts)
    .leftJoin(
      customers,
      and(
        eq(projectContacts.sourceEntityType, "customer"),
        eq(projectContacts.sourceEntityId, customers.id),
        eq(customers.organizationId, organizationId)
      )
    )
    .leftJoin(
      vendors,
      and(
        or(
          eq(projectContacts.vendorId, vendors.id),
          and(
            eq(projectContacts.sourceEntityType, "vendor"),
            eq(projectContacts.sourceEntityId, vendors.id)
          )
        ),
        eq(vendors.organizationId, organizationId)
      )
    )
    .leftJoin(
      vendorContacts,
      and(
        eq(projectContacts.vendorContactId, vendorContacts.id),
        eq(vendorContacts.vendorId, vendors.id),
        eq(vendorContacts.active, true)
      )
    )
    .leftJoin(
      users,
      and(
        eq(projectContacts.sourceEntityType, "user"),
        eq(projectContacts.sourceEntityId, users.id),
        sql`exists (
          select 1 from ${organizationMembers}
          where ${organizationMembers.userId} = ${users.id}
            and ${organizationMembers.organizationId} = ${organizationId}
        )`
      )
    )
    .where(queryWhere)
    .orderBy(
      asc(projectContacts.sortOrder),
      asc(projectContacts.contactType),
      asc(projectContacts.displayName)
    )
  const rows = directoryRows.map((row) => {
    const directoryIdentity =
      row.contact.vendorContactId
        ? {
            email: row.vendorContact?.email ?? null,
            phone: row.vendorContact?.phone ?? null,
            address: null,
          }
        : row.contact.sourceEntityType === "customer"
          ? row.customer
          : row.contact.sourceEntityType === "vendor"
            ? row.vendor
            : row.contact.sourceEntityType === "user"
              ? row.teamMember
              : null
    const identity = resolveProjectContactIdentity(
      {
        email: row.contact.email,
        phone: row.contact.phone,
        address: row.contact.address,
      },
      directoryIdentity
    )

    return { ...row.contact, ...identity }
  })

  const directoryIdentityKeys = await activeDirectoryIdentityKeys({
    db,
    organizationId,
    entityIds: rows.flatMap((row) => {
      const ids: string[] = []
      if (
        (row.sourceEntityType === "customer" ||
          row.sourceEntityType === "vendor" ||
          row.sourceEntityType === "vendor_contact") &&
        row.sourceEntityId
      ) {
        ids.push(row.sourceEntityId)
      }
      if (row.vendorContactId) ids.push(row.vendorContactId)
      return ids
    }),
  })

  const invitationRows = await db
    .select({
      projectContactId: projectAccessInvitations.projectContactId,
      email: projectAccessInvitations.email,
      status: projectAccessInvitations.status,
      workosExpiresAt: projectAccessInvitations.workosExpiresAt,
      acceptedUserActive: users.isActive,
      invitedAt: projectAccessInvitations.invitedAt,
    })
    .from(projectAccessInvitations)
    .leftJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
    .where(eq(projectAccessInvitations.projectId, projectId))
    .orderBy(desc(projectAccessInvitations.invitedAt))
  const activeProjectMemberRows = await db
    .select({
      userId: users.id,
      email: users.email,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(users.isActive, true)
      )
    )
  const latestInvitationByContactId = new Map<
    string,
    ProjectContactInvitationSnapshot
  >()
  const latestInvitationByEmail = new Map<
    string,
    ProjectContactInvitationSnapshot
  >()
  for (const invitation of invitationRows) {
    const snapshot: ProjectContactInvitationSnapshot = {
      status: invitation.status,
      workosExpiresAt: invitation.workosExpiresAt,
      acceptedUserActive: invitation.acceptedUserActive,
    }
    if (
      invitation.projectContactId &&
      !latestInvitationByContactId.has(invitation.projectContactId)
    ) {
      latestInvitationByContactId.set(invitation.projectContactId, snapshot)
    }
    const email = invitation.email.trim().toLowerCase()
    if (email && !latestInvitationByEmail.has(email)) {
      latestInvitationByEmail.set(email, snapshot)
    }
  }
  const activeProjectUserIds = new Set(
    activeProjectMemberRows.map((member) => member.userId)
  )
  const activeProjectEmails = new Set(
    activeProjectMemberRows.map((member) => member.email.trim().toLowerCase())
  )
  const toProjectContactItem = (
    row: (typeof rows)[number]
  ): ProjectContactItem => {
    const email = row.email?.trim().toLowerCase() ?? ""
    const latestInvitation =
      latestInvitationByContactId.get(row.id) ??
      (email ? latestInvitationByEmail.get(email) : undefined) ??
      null
    const activeProjectMember =
      (row.sourceEntityType === "user" &&
        row.sourceEntityId !== null &&
        activeProjectUserIds.has(row.sourceEntityId)) ||
      (email.length > 0 && activeProjectEmails.has(email))

    return toContactItem(
      row,
      row.active
        ? projectContactAccessStatus({
            activeProjectMember,
            latestInvitation,
          })
        : "not_invited",
      (row.sourceEntityId !== null &&
        directoryIdentityKeys.has(
          `${row.sourceEntityType}:${row.sourceEntityId}`
        )) ||
        (row.vendorContactId !== null &&
          directoryIdentityKeys.has(`vendor_contact:${row.vendorContactId}`))
    )
  }
  const allContacts = rows.filter((row) => row.active).map(toProjectContactItem)
  const historicalContacts = rows
    .filter((row) => !row.active)
    .map(toProjectContactItem)
  const sourceLinks = await db
    .select({
      matchStatus: projectContactSourceLinks.matchStatus,
    })
    .from(projectContactSourceLinks)
    .where(eq(projectContactSourceLinks.projectId, projectId))

  return {
    audience,
    totalCount: allContacts.length,
    ownerCount: allContacts.filter((contact) => contact.contactType === "owner")
      .length,
    supplierCount: allContacts.filter(
      (contact) => contact.contactType === "supplier"
    ).length,
    subcontractorCount: allContacts.filter(
      (contact) => contact.contactType === "subcontractor"
    ).length,
    internalCount: allContacts.filter(
      (contact) => contact.contactType === "internal"
    ).length,
    visibleToOwnerCount: allContacts.filter(
      (contact) => contact.ownerPortalVisible
    ).length,
    visibleToSubVendorCount: allContacts.filter(
      (contact) => contact.subVendorPortalVisible
    ).length,
    matchedSourceCount: sourceLinks.filter((link) =>
      ["matched", "approved"].includes(link.matchStatus)
    ).length,
    unmatchedSourceCount: sourceLinks.filter(
      (link) => link.matchStatus === "unmatched"
    ).length,
    reviewSourceCount: sourceLinks.filter(
      (link) => link.matchStatus === "review"
    ).length,
    pendingAssignmentSourceCount: sourceLinks.filter(
      (link) => link.matchStatus === "pending_assignment"
    ).length,
    approvedSourceCount: sourceLinks.filter(
      (link) => link.matchStatus === "approved"
    ).length,
    groups: buildGroups(allContacts),
    csiGroups: buildCsiGroups(allContacts),
    allContacts,
    historicalContacts,
  }
}

export async function getProjectContactDirectoryOptions(
  projectId: string
): Promise<readonly ProjectContactDirectoryOption[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "project-contacts", "update")
  const orgId = requireOrg(user)
  // The picker exposes organization-wide customer, vendor, and staff details,
  // so project read access alone is intentionally insufficient.
  const db = await verifyProjectAccess(projectId, "update")

  const existingRows = await db
    .select({
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
    })
    .from(projectContacts)
    .where(
      and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))
    )
  const existingSources = new Set(
    existingRows
      .filter(
        (row) => row.sourceEntityId !== null && row.sourceEntityId.length > 0
      )
      .map((row) => `${row.sourceEntityType}:${row.sourceEntityId}`)
  )
  const [customerRows, vendorRows, vendorContactRows, teamRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        company: customers.company,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
      })
      .from(customers)
      .where(eq(customers.organizationId, orgId)),
    db
      .select({
        id: vendors.id,
        name: vendors.name,
        category: vendors.category,
        email: vendors.email,
        phone: vendors.phone,
        address: vendors.address,
      })
      .from(vendors)
      .where(
        and(
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active")
        )
      ),
    db
      .select({
        id: vendorContacts.id,
        vendorId: vendorContacts.vendorId,
        name: vendorContacts.name,
        title: vendorContacts.title,
        email: vendorContacts.email,
        phone: vendorContacts.phone,
        isPrimary: vendorContacts.isPrimary,
      })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(
        and(
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active"),
          eq(vendorContacts.active, true)
        )
      ),
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        address: users.address,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(users.isActive, true)
        )
      ),
  ])
  const directoryIdentityKeys = await activeDirectoryIdentityKeys({
    db,
    organizationId: orgId,
    entityIds: customerRows
      .map((row) => row.id)
      .concat(vendorRows.map((row) => row.id))
      .concat(vendorContactRows.map((row) => row.id)),
  })
  const contactsByVendor = new Map<string, ProjectVendorContactOption[]>()
  for (const contact of vendorContactRows) {
    const option: ProjectVendorContactOption = {
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
      identityManagedByActiveUser: directoryIdentityKeys.has(
        `vendor_contact:${contact.id}`
      ),
    }
    const current = contactsByVendor.get(contact.vendorId) ?? []
    current.push(option)
    contactsByVendor.set(contact.vendorId, current)
  }

  const customerOptions: ProjectContactDirectoryOption[] = customerRows
    .map((row) => ({
      id: row.id,
      sourceType: "customer",
      displayName: row.name,
      companyName: row.company,
      email: row.email,
      phone: row.phone,
      address: row.address,
      suggestedContactType: "owner",
      identityManagedByActiveUser: directoryIdentityKeys.has(
        `customer:${row.id}`
      ),
      vendorContacts: [],
    }))
  const vendorOptions: ProjectContactDirectoryOption[] = vendorRows
    .filter((row) => !row.category.toLowerCase().includes("internal"))
    .map((row) => ({
      id: row.id,
      sourceType: "vendor",
      displayName: row.name,
      companyName: row.name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      suggestedContactType: vendorCategoryToContactType(row.category),
      identityManagedByActiveUser: directoryIdentityKeys.has(
        `vendor:${row.id}`
      ),
      vendorContacts: (contactsByVendor.get(row.id) ?? []).sort((left, right) =>
        Number(right.isPrimary) - Number(left.isPrimary) ||
        left.name.localeCompare(right.name)
      ),
    }))
  const teamOptions: ProjectContactDirectoryOption[] = teamRows
    .filter(
      (row) =>
        isInternalStaffRole(row.role) &&
        !existingSources.has(`user:${row.id}`)
    )
    .map((row) => {
      const fullName = [row.firstName, row.lastName]
        .filter((part): part is string => part !== null && part.trim().length > 0)
        .join(" ")
      return {
        id: row.id,
        sourceType: "team",
        displayName: row.displayName?.trim() || fullName || row.email,
        companyName: null,
        email: row.email,
        phone: row.phone,
        address: row.address,
        suggestedContactType: "internal",
        identityManagedByActiveUser: true,
        vendorContacts: [],
      }
    })

  return [...customerOptions, ...vendorOptions, ...teamOptions].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  )
}

export async function getProjectContactSageOptions(
  projectId: string
): Promise<ProjectContactSageOptions> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "project-contacts", "update")
  const db = await verifyProjectAccess(projectId, "update")
  const rows = await db
    .select({
      code: sageCostCodes.code,
      description: sageCostCodes.description,
      divisionCode: sageCostCodes.divisionCode,
      divisionDescription: sageCostCodes.divisionDescription,
    })
    .from(sageCostCodes)
    .where(eq(sageCostCodes.active, true))
    .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.code))

  const divisions = new Map<string, ProjectContactDivisionOption>()
  const costCodes = new Map<string, ProjectContactCostCodeOption>()
  for (const row of rows) {
    const description =
      row.code === `${row.divisionCode} 00 00`
        ? row.divisionDescription
        : row.description
    divisions.set(row.divisionCode, {
      value: row.divisionCode,
      label: `${row.divisionCode} 00 00 - ${row.divisionDescription}`,
      name: row.divisionDescription,
    })
    costCodes.set(row.code, {
      value: row.code,
      label: `${row.code} - ${description}`,
      description,
      divisionCode: row.divisionCode,
      divisionName: row.divisionDescription,
    })
  }

  return {
    divisions: Array.from(divisions.values()),
    costCodes: Array.from(costCodes.values()),
  }
}

export async function saveProjectContact(
  input: ProjectContactMutationInput
): Promise<ProjectContactMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "project-contacts", "update")
    if (!input.projectId.trim()) {
      return { success: false, error: "Project is required" }
    }
    if (!input.displayName.trim()) {
      return { success: false, error: "Contact name is required" }
    }
    if (!validContactType(input.contactType)) {
      return { success: false, error: "Choose a valid contact type" }
    }

    const orgId = requireOrg(user)
    const db = await verifyProjectAccess(input.projectId, "update")
    const now = new Date().toISOString()
    let contactId = input.contactId
    let sourceSystem = "compass"
    let sourceRecordId: string | null = null
    let sourceEntityType = "manual"
    let sourceEntityId: string | null = null
    let vendorId: string | null = input.vendorId
    let vendorContactId: string | null = input.vendorContactId
    let syncStatus = "manual"
    let warning: string | undefined
    let directoryIdentity: ContactIdentityFields | null = null
    let directoryIdentityManaged = false
    let canonicalDisplayName: string | null = null
    let canonicalCompanyName: string | null = null

    const requiresVendorCompany =
      input.contactType === "subcontractor" || input.contactType === "supplier"
    if (
      requiresVendorCompany &&
      (input.directorySourceType !== "vendor" || !input.directorySourceId)
    ) {
      return {
        success: false,
        error: "Choose a vendor company for this project contact.",
      }
    }
    if (
      input.contactType === "owner" &&
      input.directorySourceType !== null &&
      input.directorySourceType !== "customer"
    ) {
      return { success: false, error: "Choose a client or lead contact." }
    }
    if (
      input.contactType === "internal" &&
      input.directorySourceType !== null &&
      input.directorySourceType !== "team"
    ) {
      return { success: false, error: "Choose a Settings team member." }
    }

    if (input.directorySourceType && input.directorySourceId) {
      sourceRecordId = input.directorySourceId
      sourceEntityId = input.directorySourceId

      if (input.directorySourceType === "customer") {
        const [directoryRecord] = await db
          .select({
            id: customers.id,
            name: customers.name,
            company: customers.company,
            email: customers.email,
            phone: customers.phone,
            address: customers.address,
          })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.directorySourceId),
              eq(customers.organizationId, orgId)
            )
          )
          .limit(1)
        if (!directoryRecord) {
          return { success: false, error: "Customer directory record not found" }
        }
        sourceSystem = "customer_directory"
        sourceEntityType = "customer"
        canonicalDisplayName = directoryRecord.name
        canonicalCompanyName = directoryRecord.company
        directoryIdentity = directoryRecord
        directoryIdentityManaged =
          await directoryIdentityManagedByActiveUser({
            db,
            organizationId: orgId,
            entityType: "customer",
            entityId: directoryRecord.id,
          })
      } else if (input.directorySourceType === "vendor") {
        const [directoryRecord] = await db
          .select({
            id: vendors.id,
            name: vendors.name,
            syncStatus: vendors.syncStatus,
            email: vendors.email,
            phone: vendors.phone,
            address: vendors.address,
          })
          .from(vendors)
          .where(
            and(
              eq(vendors.id, input.directorySourceId),
              eq(vendors.organizationId, orgId),
              eq(vendors.directoryStatus, "active")
            )
          )
          .limit(1)
        if (!directoryRecord) {
          return { success: false, error: "Vendor directory record not found" }
        }
        sourceSystem = "global_directory"
        syncStatus = directoryRecord.syncStatus
        vendorId = directoryRecord.id
        vendorContactId = input.vendorContactId
        if (vendorContactId) {
          const contactRecord = await db
            .select({
              id: vendorContacts.id,
              name: vendorContacts.name,
              email: vendorContacts.email,
              phone: vendorContacts.phone,
            })
            .from(vendorContacts)
            .where(
              and(
                eq(vendorContacts.id, vendorContactId),
                eq(vendorContacts.vendorId, directoryRecord.id),
                eq(vendorContacts.active, true)
              )
            )
            .get()
          if (!contactRecord) {
            return { success: false, error: "Vendor contact not found" }
          }
          canonicalDisplayName = contactRecord.name
          canonicalCompanyName = directoryRecord.name
          sourceRecordId = contactRecord.id
          sourceEntityType = "vendor_contact"
          sourceEntityId = contactRecord.id
          directoryIdentity = { ...contactRecord, address: null }
          directoryIdentityManaged =
            await directoryIdentityManagedByActiveUser({
              db,
              organizationId: orgId,
              entityType: "vendor_contact",
              entityId: contactRecord.id,
            })
        } else {
          canonicalDisplayName = directoryRecord.name
          canonicalCompanyName = directoryRecord.name
          sourceRecordId = directoryRecord.id
          sourceEntityType = "vendor"
          sourceEntityId = directoryRecord.id
          directoryIdentity = directoryRecord
          directoryIdentityManaged =
            await directoryIdentityManagedByActiveUser({
              db,
              organizationId: orgId,
              entityType: "vendor",
              entityId: directoryRecord.id,
            })
        }
      } else {
        const [directoryRecord] = await db
          .select({
            id: users.id,
            email: users.email,
            phone: users.phone,
            address: users.address,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, orgId),
              eq(users.id, input.directorySourceId),
              eq(users.isActive, true)
            )
          )
          .limit(1)
        if (!directoryRecord) {
          return { success: false, error: "Team directory record not found" }
        }
        sourceSystem = "organization_directory"
        sourceEntityType = "user"
        directoryIdentity = directoryRecord
        directoryIdentityManaged = true
      }

      if (!sourceEntityId) {
        return { success: false, error: "Directory contact not found" }
      }

      const [existingContact] = await db
        .select({ id: projectContacts.id, active: projectContacts.active })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.projectId, input.projectId),
            eq(projectContacts.sourceEntityType, sourceEntityType),
            eq(projectContacts.sourceEntityId, sourceEntityId)
          )
        )
        .limit(1)
      if (existingContact?.active && existingContact.id !== contactId) {
        return { success: false, error: "This contact is already on the project" }
      }
      if (!contactId && existingContact) contactId = existingContact.id
    }

    const contactValues = {
      contactType: input.contactType,
      displayName: canonicalDisplayName ?? input.displayName.trim(),
      companyName: canonicalCompanyName ?? nullableInput(input.companyName),
      role: nullableInput(input.role),
      trade: nullableInput(input.trade),
      csiDivision: nullableInput(input.csiDivision),
      csiDivisionName: nullableInput(input.csiDivisionName),
      primaryCostCode: nullableInput(input.primaryCostCode),
      email: nullableInput(input.email),
      phone: nullableInput(input.phone),
      address: nullableInput(input.address),
      notes: nullableInput(input.notes),
      ownerPortalVisible: input.ownerPortalVisible,
      subVendorPortalVisible: input.subVendorPortalVisible,
      internalVisible: input.internalVisible,
      primaryContact: input.primaryContact,
      active: true,
      updatedAt: now,
    }

    if (
      directoryIdentityManaged &&
      directoryIdentity &&
      contactIdentityChanged(directoryIdentity, contactValues)
    ) {
      return {
        success: false,
        error:
          "Phone, email, and address are managed by this active Compass user. Add the directory contact without changing those fields.",
      }
    }

    if (contactId) {
      const [existingContact] = await db
        .select({
          id: projectContacts.id,
          email: projectContacts.email,
          phone: projectContacts.phone,
          address: projectContacts.address,
          sourceEntityType: projectContacts.sourceEntityType,
          sourceEntityId: projectContacts.sourceEntityId,
          sourceSystem: projectContacts.sourceSystem,
          sourceRecordId: projectContacts.sourceRecordId,
          syncStatus: projectContacts.syncStatus,
          vendorId: projectContacts.vendorId,
          vendorContactId: projectContacts.vendorContactId,
        })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.id, contactId),
            eq(projectContacts.projectId, input.projectId)
          )
        )
        .limit(1)
      if (!existingContact) {
        return { success: false, error: "Project contact not found" }
      }
      if (!input.directorySourceType) {
        sourceSystem = existingContact.sourceSystem
        sourceRecordId = existingContact.sourceRecordId
        sourceEntityType = existingContact.sourceEntityType
        sourceEntityId = existingContact.sourceEntityId
        syncStatus = existingContact.syncStatus
        vendorId = existingContact.vendorId
        vendorContactId = existingContact.vendorContactId
      }
      const existingEmail = existingContact.email?.trim().toLowerCase() ?? ""
      const updatedEmail = nullableInput(input.email)?.toLowerCase() ?? ""
      const existingPhone = existingContact.phone?.trim() ?? ""
      const updatedPhone = nullableInput(input.phone) ?? ""
      const existingAddress = existingContact.address?.trim() ?? ""
      const updatedAddress = nullableInput(input.address) ?? ""
      const identityChanged =
        existingEmail !== updatedEmail ||
        existingPhone !== updatedPhone ||
        existingAddress !== updatedAddress
      if (identityChanged) {
        const existingDirectoryEntityType = existingContact.vendorContactId
          ? "vendor_contact"
          : existingContact.sourceEntityType === "customer" ||
              existingContact.sourceEntityType === "vendor"
            ? existingContact.sourceEntityType
            : null
        const existingDirectoryEntityId =
          existingContact.vendorContactId ?? existingContact.sourceEntityId
        if (
          existingDirectoryEntityType &&
          existingDirectoryEntityId &&
          (await directoryIdentityManagedByActiveUser({
            db,
            organizationId: orgId,
            entityType: existingDirectoryEntityType,
            entityId: existingDirectoryEntityId,
          }))
        ) {
          return {
            success: false,
            error:
              "Phone, email, and address are managed by this active Compass user. You can still update their project role and visibility.",
          }
        }
        const [activeInvitationRows, organizationUserRows] = await Promise.all([
          db
            .select({ userId: users.id })
            .from(projectAccessInvitations)
            .innerJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
            .where(
              and(
                eq(projectAccessInvitations.projectId, input.projectId),
                eq(projectAccessInvitations.projectContactId, contactId),
                eq(projectAccessInvitations.status, "accepted"),
                eq(users.isActive, true)
              )
            ),
          db
            .select({ id: users.id, email: users.email })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
              and(
                eq(organizationMembers.organizationId, orgId),
                eq(users.isActive, true)
              )
            ),
        ])
        const linkedUserIds = new Set<string>()
        if (
          existingContact.sourceEntityType === "user" &&
          existingContact.sourceEntityId
        ) {
          linkedUserIds.add(existingContact.sourceEntityId)
        }
        if (existingEmail) {
          for (const organizationUser of organizationUserRows) {
            if (organizationUser.email.trim().toLowerCase() === existingEmail) {
              linkedUserIds.add(organizationUser.id)
            }
          }
        }
        const linkedUserIdList = Array.from(linkedUserIds)
        const linkedMembership =
          linkedUserIdList.length > 0
            ? await db
                .select({ id: projectMembers.id })
                .from(projectMembers)
                .where(
                  and(
                    eq(projectMembers.projectId, input.projectId),
                    inArray(projectMembers.userId, linkedUserIdList)
                  )
                )
                .limit(1)
            : []
        if (activeInvitationRows.length > 0 || linkedMembership.length > 0) {
          return {
            success: false,
            error:
              "Phone, email, and address are managed by this active Compass user. You can still update their project role and visibility.",
          }
        }

        if (existingEmail !== updatedEmail) {
          const pendingInvitations = await db
            .select({
              id: projectAccessInvitations.id,
              workosInvitationId: projectAccessInvitations.workosInvitationId,
            })
            .from(projectAccessInvitations)
            .where(
              and(
                eq(projectAccessInvitations.projectId, input.projectId),
                eq(projectAccessInvitations.projectContactId, contactId),
                eq(projectAccessInvitations.status, "sent")
              )
            )
          const workosInvitationIds = pendingInvitations.flatMap((invitation) =>
            invitation.workosInvitationId
              ? [invitation.workosInvitationId]
              : []
          )
          if (workosInvitationIds.length > 0) {
            const { env } = await getCloudflareContext()
            const workosApiKey = environmentString(env, "WORKOS_API_KEY")
            if (!workosApiKey || workosApiKey.includes("placeholder")) {
              return {
                success: false,
                error:
                  "The pending access invitation must be revoked before changing this email, but WorkOS is not configured.",
              }
            }
            const { WorkOS } = await import("@workos-inc/node")
            const workos = new WorkOS(workosApiKey)
            for (const invitationId of workosInvitationIds) {
              await workos.userManagement.revokeInvitation(invitationId)
            }
          }
          if (pendingInvitations.length > 0) {
            await db
              .update(projectAccessInvitations)
              .set({ status: "revoked", updatedAt: now })
              .where(
                and(
                  eq(projectAccessInvitations.projectId, input.projectId),
                  eq(projectAccessInvitations.projectContactId, contactId),
                  eq(projectAccessInvitations.status, "sent")
                )
              )
              .run()
            warning =
              "The old pending access invitation was revoked. Send a new invitation to the updated email."
          }
        }
      }
      if (input.primaryContact) {
        await db
          .update(projectContacts)
          .set({ primaryContact: false, updatedAt: now })
          .where(
            and(
              eq(projectContacts.projectId, input.projectId),
              eq(projectContacts.contactType, input.contactType)
            )
          )
      }
      await db
        .update(projectContacts)
        .set({
          ...contactValues,
          sourceSystem,
          sourceRecordId,
          sourceEntityType,
          sourceEntityId,
          vendorId,
          vendorContactId,
          syncStatus,
        })
        .where(
          and(
            eq(projectContacts.id, contactId),
            eq(projectContacts.projectId, input.projectId)
          )
        )
    } else {
      contactId = crypto.randomUUID()
      if (input.primaryContact) {
        await db
          .update(projectContacts)
          .set({ primaryContact: false, updatedAt: now })
          .where(
            and(
              eq(projectContacts.projectId, input.projectId),
              eq(projectContacts.contactType, input.contactType)
            )
          )
      }
      await db.insert(projectContacts).values({
        id: contactId,
        projectId: input.projectId,
        sourceSystem,
        sourceRecordId,
        sourceEntityType,
        sourceEntityId,
        vendorId,
        vendorContactId,
        sortOrder: 800,
        syncStatus,
        lastSyncedAt: null,
        createdAt: now,
        ...contactValues,
      })
    }

    if (sourceEntityType === "customer" && sourceEntityId) {
      await db.batch([
        db
          .update(customers)
          .set({
            email: contactValues.email,
            phone: contactValues.phone,
            address: contactValues.address,
            updatedAt: now,
          })
          .where(
            and(
              eq(customers.id, sourceEntityId),
              eq(customers.organizationId, orgId)
            )
          ),
        db
          .update(projectContacts)
          .set({
            email: contactValues.email,
            phone: contactValues.phone,
            address: contactValues.address,
            updatedAt: now,
          })
          .where(
            and(
              eq(projectContacts.sourceEntityType, "customer"),
              eq(projectContacts.sourceEntityId, sourceEntityId)
            )
          ),
      ])
    } else if (vendorContactId) {
      await db.batch([
        db
          .update(vendorContacts)
          .set({
            name: contactValues.displayName,
            email: contactValues.email,
            phone: contactValues.phone,
            updatedAt: now,
          })
          .where(eq(vendorContacts.id, vendorContactId)),
        db
          .update(projectContacts)
          .set({
            displayName: contactValues.displayName,
            email: contactValues.email,
            phone: contactValues.phone,
            updatedAt: now,
          })
          .where(eq(projectContacts.vendorContactId, vendorContactId)),
      ])
    } else if (vendorId) {
      await db.batch([
        db
          .update(vendors)
          .set({
            email: contactValues.email,
            phone: contactValues.phone,
            address: contactValues.address,
            updatedAt: now,
          })
          .where(
            and(
              eq(vendors.id, vendorId),
              eq(vendors.organizationId, orgId)
            )
          ),
        db
          .update(projectContacts)
          .set({
            email: contactValues.email,
            phone: contactValues.phone,
            address: contactValues.address,
            updatedAt: now,
          })
          .where(
            or(
              and(
                eq(projectContacts.vendorId, vendorId),
                isNull(projectContacts.vendorContactId)
              ),
              and(
                eq(projectContacts.sourceEntityType, "vendor"),
                eq(projectContacts.sourceEntityId, vendorId),
                isNull(projectContacts.vendorContactId)
              )
            )
          ),
      ])
    }

    await queueProjectContactTrackerRefresh({
      db,
      organizationId: orgId,
      projectId: input.projectId,
    })
    revalidateContactPaths(input.projectId)
    return { success: true, contactId, ...(warning ? { warning } : {}) }
  } catch (error) {
    console.error("Failed to save project contact", error)
    return { success: false, error: "Failed to save project contact" }
  }
}

export async function removeProjectContact(
  projectId: string,
  contactId: string
): Promise<ProjectContactMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "project-contacts", "update")
    const orgId = requireOrg(user)
    const db = await verifyProjectAccess(projectId, "update")
    const [contact] = await db
      .select({
        id: projectContacts.id,
        sourceEntityType: projectContacts.sourceEntityType,
        sourceEntityId: projectContacts.sourceEntityId,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, contactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .limit(1)
    if (!contact) return { success: false, error: "Project contact not found" }

    const invitationRows = await db
      .select({ acceptedBy: projectAccessInvitations.acceptedBy })
      .from(projectAccessInvitations)
      .where(
        and(
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, contactId)
        )
      )
    const memberUserIds = new Set(
      invitationRows
        .map((invitation) => invitation.acceptedBy)
        .filter((acceptedBy): acceptedBy is string => acceptedBy !== null)
    )
    if (contact.sourceEntityType === "user" && contact.sourceEntityId) {
      memberUserIds.add(contact.sourceEntityId)
    }
    const organizationUsers = await db
      .select({ id: users.id, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, orgId))
    if (contact.email) {
      const contactEmail = contact.email.trim().toLowerCase()
      for (const organizationUser of organizationUsers) {
        if (organizationUser.email.trim().toLowerCase() === contactEmail) {
          memberUserIds.add(organizationUser.id)
        }
      }
    }

    const now = new Date().toISOString()
    await db
      .update(projectContacts)
      .set({
        active: false,
        ownerPortalVisible: false,
        subVendorPortalVisible: false,
        internalVisible: false,
        primaryContact: false,
        updatedAt: now,
      })
      .where(
        and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, projectId))
      )
    await db
      .update(projectContactSourceLinks)
      .set({
        projectContactId: null,
        matchStatus: "review",
        matchConfidence: 0,
        matchReason: "Project contact was removed in Compass and needs reassignment.",
        updatedAt: now,
      })
      .where(
        and(
          eq(projectContactSourceLinks.projectId, projectId),
          eq(projectContactSourceLinks.projectContactId, contactId)
        )
      )
    await db
      .update(projectAccessInvitations)
      .set({ status: "revoked", updatedAt: now })
      .where(
        and(
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, contactId)
        )
      )
    const projectMemberIds = Array.from(memberUserIds)
    if (projectMemberIds.length > 0) {
      // One person can have multiple project-contact roles. Preserve access
      // whenever another active contact or invitation still grants it.
      const [remainingContacts, remainingInvitations] = await Promise.all([
        db
          .select({
            sourceEntityType: projectContacts.sourceEntityType,
            sourceEntityId: projectContacts.sourceEntityId,
            email: projectContacts.email,
          })
          .from(projectContacts)
          .where(
            and(
              eq(projectContacts.projectId, projectId),
              eq(projectContacts.active, true)
            )
          ),
        db
          .select({
            acceptedBy: projectAccessInvitations.acceptedBy,
            email: projectAccessInvitations.email,
            status: projectAccessInvitations.status,
          })
          .from(projectAccessInvitations)
          .where(eq(projectAccessInvitations.projectId, projectId)),
      ])
      const remainingUserIds = new Set(
        remainingContacts
          .filter(
            (remainingContact) =>
              remainingContact.sourceEntityType === "user" &&
              remainingContact.sourceEntityId !== null
          )
          .map((remainingContact) => remainingContact.sourceEntityId)
          .filter((userId): userId is string => userId !== null)
      )
      const remainingEmails = new Set(
        remainingContacts
          .map((remainingContact) =>
            remainingContact.email?.trim().toLowerCase() ?? ""
          )
          .filter((email) => email.length > 0)
      )
      for (const invitation of remainingInvitations) {
        if (invitation.status !== "accepted") continue
        if (invitation.acceptedBy) remainingUserIds.add(invitation.acceptedBy)
        const invitationEmail = invitation.email.trim().toLowerCase()
        if (invitationEmail) remainingEmails.add(invitationEmail)
      }
      const organizationEmailByUserId = new Map(
        organizationUsers.map((organizationUser) => [
          organizationUser.id,
          organizationUser.email.trim().toLowerCase(),
        ])
      )
      const removableMemberIds = projectMemberIds.filter((userId) => {
        const email = organizationEmailByUserId.get(userId)
        return (
          !remainingUserIds.has(userId) &&
          (!email || !remainingEmails.has(email))
        )
      })
      if (removableMemberIds.length > 0) {
        await db
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              inArray(projectMembers.userId, removableMemberIds)
            )
          )
      }
    }

    await queueProjectContactTrackerRefresh({
      db,
      organizationId: orgId,
      projectId,
    })
    revalidateContactPaths(projectId)
    return { success: true, contactId }
  } catch (error) {
    console.error("Failed to remove project contact", error)
    return { success: false, error: "Failed to remove project contact" }
  }
}

export async function getProjectTaskAssigneeOptions(
  projectId: string
): Promise<ProjectTaskAssigneeOptions> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "tasks", "update")
  const db = await verifyProjectAccess(projectId)
  const orgId = requireOrg(user)

  const projectContactRows = await db
    .select()
    .from(projectContacts)
    .where(
      and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))
    )
    .orderBy(
      asc(projectContacts.contactType),
      asc(projectContacts.displayName)
    )

  const projectContactItems = projectContactRows.map((row) =>
    toContactItem(row)
  )
  const projectSourceVendorIds = new Set(
    projectContactItems
      .map((contact) =>
        contact.vendorId ??
        (contact.sourceEntityType === "vendor" ? contact.sourceEntityId : null)
      )
      .filter((value): value is string => value !== null)
  )
  const projectNameKeys = new Set(
    projectContactItems.map((contact) =>
      normalizeDirectoryKey(contact.companyName ?? contact.displayName)
    )
  )
  const projectAssigneeNameKeys = new Set(
    projectContactItems.map((contact) =>
      normalizeDirectoryKey(contact.displayName)
    )
  )
  const projectEmailKeys = new Set(
    projectContactItems
      .map((contact) => contact.email?.trim().toLowerCase() ?? "")
      .filter((email) => email.length > 0)
  )

  const organizationUserRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(users.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))
  const organizationUserOptions = organizationUserRows
    .map(organizationUserToTaskAssigneeOption)
    .filter(
      (option) =>
        !projectAssigneeNameKeys.has(normalizeDirectoryKey(option.name)) &&
        !projectEmailKeys.has(option.email?.trim().toLowerCase() ?? "")
    )

  const directoryRows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      email: vendors.email,
      phone: vendors.phone,
    })
    .from(vendors)
    .where(
      and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active"))
    )
    .orderBy(asc(vendors.name))

  const directoryContacts = directoryRows
    .filter(
      (vendor) =>
        isDirectoryAssignable(vendor.category) &&
        !projectSourceVendorIds.has(vendor.id) &&
        !projectNameKeys.has(normalizeDirectoryKey(vendor.name))
    )
    .map(directoryContactToTaskAssigneeOption)

  return {
    projectContacts: [
      ...projectContactItems.map(projectContactToTaskAssigneeOption),
      ...organizationUserOptions,
    ],
    directoryContacts,
  }
}

export async function getProjectPurchaseOrderSiteContactOptions(
  projectId: string
): Promise<readonly ProjectTaskAssigneeOption[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "purchase-orders", "read")
  const db = await verifyProjectAccess(projectId)
  const orgId = requireOrg(user)

  const projectRows = await db
    .select()
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.contactType, "internal"),
        eq(projectContacts.active, true)
      )
    )
    .orderBy(asc(projectContacts.displayName))
  const projectOptions = projectRows
    .map((row) => toContactItem(row))
    .map(projectContactToTaskAssigneeOption)
  const projectNameKeys = new Set(
    projectOptions.map((option) => normalizeDirectoryKey(option.name))
  )
  const projectEmailKeys = new Set(
    projectOptions
      .map((option) => option.email?.trim().toLowerCase() ?? "")
      .filter((email) => email.length > 0)
  )

  const organizationRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(users.isActive, true)
      )
    )
    .orderBy(asc(users.displayName), asc(users.email))
  const organizationOptions = organizationRows
    .map((row) => ({
      ...organizationUserToTaskAssigneeOption(row),
      phone: row.phone,
    }))
    .filter(
      (option) =>
        !projectNameKeys.has(normalizeDirectoryKey(option.name)) &&
        !projectEmailKeys.has(option.email?.trim().toLowerCase() ?? "")
    )

  return [...projectOptions, ...organizationOptions]
}

export async function getProjectContactMatchReview(
  projectId: string
): Promise<ProjectContactMatchReview> {
  const db = await verifyProjectAccess(projectId)

  const contactRows = await db
    .select()
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
    .orderBy(
      asc(projectContacts.contactType),
      asc(projectContacts.displayName)
    )

  const contacts = contactRows.map((row) => toContactItem(row))
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))

  const user = await requireAuth()
  const orgId = requireOrg(user)
  const independentContacts = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      sourceSystem: vendors.sourceSystem,
      syncStatus: vendors.syncStatus,
    })
    .from(vendors)
    .where(and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active")))
    .orderBy(asc(vendors.name))

  const linkRows = await db
    .select()
    .from(projectContactSourceLinks)
    .where(eq(projectContactSourceLinks.projectId, projectId))
    .orderBy(
      asc(projectContactSourceLinks.matchStatus),
      asc(projectContactSourceLinks.sourceName),
      asc(projectContactSourceLinks.sourceLabel)
    )

  const links = linkRows.map((link) =>
    toSourceLinkItem(
      link,
      link.projectContactId ? contactsById.get(link.projectContactId) : undefined
    )
  )

  return {
    projectId,
    contacts,
    independentContacts: independentContacts
      .filter(
        (contact) =>
          !["Nu-Tech Systems", "Window Supplier TBD"].includes(contact.name) &&
          isDirectoryAssignable(contact.category)
      )
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        category: contact.category,
        sourceSystem: contact.sourceSystem,
        syncStatus: contact.syncStatus,
        contactType: vendorCategoryToContactType(contact.category),
      })),
    links,
    matchedCount: links.filter((link) => link.matchStatus === "matched").length,
    reviewCount: links.filter((link) => link.matchStatus === "review").length,
    unmatchedCount: links.filter((link) => link.matchStatus === "unmatched").length,
    pendingAssignmentCount: links.filter(
      (link) => link.matchStatus === "pending_assignment"
    ).length,
    approvedCount: links.filter((link) => link.matchStatus === "approved").length,
    ignoredCount: links.filter((link) => link.matchStatus === "ignored").length,
  }
}

export async function addIndependentContactToProjectFromReview(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const orgId = requireOrg(user)
    const projectId = requireStringField(formData, "projectId")
    const vendorId = requireStringField(formData, "independentContactId")
    const linkIds = requireLinkIds(formData)
    const db = await verifyProjectAccess(projectId, "update")

    const [vendor] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, orgId)))
      .limit(1)

    if (!vendor) return { success: false, error: "Directory contact not found" }

    const existing = await db
      .select({ id: projectContacts.id })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityId, vendor.id)
        )
      )
      .limit(1)

    const contactType = vendorCategoryToContactType(vendor.category)
    const contactId =
      existing[0]?.id ??
      `project-contact-${sourceIdPart(projectId)}-${sourceIdPart(contactType)}-${sourceIdPart(vendor.name)}`
    const now = new Date().toISOString()

    if (!existing[0]) {
      await db.insert(projectContacts).values({
        id: contactId,
        projectId,
        contactType,
        sourceSystem: "global_directory",
        sourceRecordId: vendor.id,
        sourceEntityType: "vendor",
        sourceEntityId: vendor.id,
        vendorId: vendor.id,
        vendorContactId: null,
        displayName: vendor.name,
        companyName: vendor.name,
        role: contactType === "supplier" ? "Supplier" : "Subcontractor",
        trade: null,
        csiDivision: null,
        csiDivisionName: null,
        primaryCostCode: null,
        email: vendor.email,
        phone: vendor.phone,
        notes: "Added from independent contact directory in match review.",
        ownerPortalVisible: false,
        subVendorPortalVisible: true,
        internalVisible: true,
        primaryContact: false,
        active: true,
        sortOrder: 850,
        syncStatus:
          vendor.syncStatus === "needs_sage_review"
            ? "needs_sage_review"
            : "synced",
        lastSyncedAt: vendor.lastSyncedAt ?? now,
        createdAt: now,
        updatedAt: now,
      })
    }

    await db
      .update(projectContactSourceLinks)
      .set({
        projectContactId: contactId,
        matchStatus: "matched",
        matchConfidence: 1,
        matchReason: "Added from independent contact directory in Compass match review.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to add directory contact to project", error)
    return { success: false, error: "Failed to add directory contact" }
  }
}

export async function addDirectoryContactToProjectForTask(
  projectId: string,
  directoryContactId: string
): Promise<AddTaskAssigneeContactResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "tasks", "update")

    const orgId = requireOrg(user)
    const db = await verifyProjectAccess(projectId, "update")

    const [vendor] = await db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.id, directoryContactId),
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active")
        )
      )
      .limit(1)

    if (!vendor) {
      return { success: false, error: "Directory contact not found" }
    }
    if (!isDirectoryAssignable(vendor.category)) {
      return { success: false, error: "This directory contact is not assignable" }
    }

    const [existing] = await db
      .select()
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityId, vendor.id)
        )
      )
      .limit(1)

    if (existing) {
      const existingContact = toContactItem(existing)
      revalidateContactPaths(projectId)
      return {
        success: true,
        contact: projectContactToTaskAssigneeOption(existingContact),
      }
    }

    const now = new Date().toISOString()
    const contactType = vendorCategoryToContactType(vendor.category)
    const role =
      contactType === "supplier"
        ? "Supplier"
        : contactType === "internal"
          ? "Internal"
          : "Subcontractor"
    const contactId = `project-contact-${sourceIdPart(projectId)}-${sourceIdPart(contactType)}-${sourceIdPart(vendor.id)}`

    await db.insert(projectContacts).values({
      id: contactId,
      projectId,
      contactType,
      sourceSystem: "global_directory",
      sourceRecordId: vendor.id,
      sourceEntityType: "vendor",
      sourceEntityId: vendor.id,
      vendorId: vendor.id,
      vendorContactId: null,
      displayName: vendor.name,
      companyName: vendor.name,
      role,
      trade: null,
      csiDivision: null,
      csiDivisionName: null,
      primaryCostCode: null,
      email: vendor.email,
      phone: vendor.phone,
      notes:
        "Added from task assignment in Compass. Portal visibility should be reviewed separately.",
      ownerPortalVisible: false,
      subVendorPortalVisible: false,
      internalVisible: true,
      primaryContact: false,
      active: true,
      sortOrder: 850,
      syncStatus:
        vendor.syncStatus === "needs_sage_review"
          ? "needs_sage_review"
          : "synced",
      lastSyncedAt: vendor.lastSyncedAt ?? now,
      createdAt: now,
      updatedAt: now,
    })

    revalidateContactPaths(projectId)
    return {
      success: true,
      contact: {
        id: `project:${contactId}`,
        label: vendor.name,
        name: vendor.name,
        companyName: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        contactType,
        source: "project",
        projectContactId: contactId,
        directoryContactId: null,
        projectAccess: true,
      },
    }
  } catch (error) {
    console.error("Failed to add task assignee to project contacts", error)
    return { success: false, error: "Failed to add contact to project" }
  }
}

export async function approveContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const linkIds = requireLinkIds(formData)
    const db = await verifyProjectAccess(projectId, "update")

    const links = await db
      .select()
      .from(projectContactSourceLinks)
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    if (links.length !== linkIds.length) {
      return { success: false, error: "Source link not found" }
    }
    if (links.some((link) => !link.projectContactId)) {
      return { success: false, error: "Choose a contact before approving" }
    }

    await db
      .update(projectContactSourceLinks)
      .set({
        matchStatus: "approved",
        matchConfidence: 1,
        matchReason: "Approved in Compass match review.",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to approve contact source link", error)
    return { success: false, error: "Failed to approve contact match" }
  }
}

export async function assignContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const linkIds = requireLinkIds(formData)
    const projectContactId = requireStringField(formData, "projectContactId")
    const db = await verifyProjectAccess(projectId, "update")

    const [contact] = await db
      .select({ id: projectContacts.id })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, projectContactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .limit(1)

    if (!contact) return { success: false, error: "Contact not found" }

    const links = await db
      .select({ id: projectContactSourceLinks.id })
      .from(projectContactSourceLinks)
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    if (links.length !== linkIds.length) {
      return { success: false, error: "Source link not found" }
    }

    await db
      .update(projectContactSourceLinks)
      .set({
        projectContactId,
        matchStatus: "matched",
        matchConfidence: 1,
        matchReason: "Assigned in Compass match review.",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to assign contact source link", error)
    return { success: false, error: "Failed to assign contact match" }
  }
}

export async function createContactFromSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const linkIds = requireLinkIds(formData)
    const contactType = toWritableContactType(
      requireStringField(formData, "contactType")
    )
    const db = await verifyProjectAccess(projectId, "update")

    const links = await db
      .select()
      .from(projectContactSourceLinks)
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    if (links.length !== linkIds.length) {
      return { success: false, error: "Source link not found" }
    }

    const now = new Date().toISOString()
    const link = links[0]
    if (!link) return { success: false, error: "Source link not found" }
    const contactId = crypto.randomUUID()
    const isExternal = contactType === "supplier" || contactType === "subcontractor"

    await db.insert(projectContacts).values({
      id: contactId,
      projectId,
      contactType,
      sourceSystem: "compass_review",
      sourceRecordId: link.id,
      sourceEntityType: "manual_pending_sage",
      sourceEntityId: null,
      displayName: link.sourceName,
      companyName: isExternal ? link.sourceName : null,
      role:
        contactType === "owner"
          ? "Owner"
          : contactType === "internal"
            ? "Internal"
            : contactType === "supplier"
              ? "Supplier"
              : "Subcontractor",
      trade: null,
      csiDivision: null,
      csiDivisionName: null,
      primaryCostCode: null,
      email: null,
      phone: null,
      notes: `Created from Compass match review using ${links.length} source row${links.length === 1 ? "" : "s"}. First source: ${link.sourceSystem} ${link.sourceRecordType}: ${link.sourceLabel}`,
      ownerPortalVisible: false,
      subVendorPortalVisible: isExternal,
      internalVisible: true,
      primaryContact: false,
      active: true,
      sortOrder: 800,
      syncStatus: "needs_sage_review",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    await db
      .update(projectContactSourceLinks)
      .set({
        projectContactId: contactId,
        matchStatus: "matched",
        matchConfidence: 1,
        matchReason: "Created as a Compass project contact from match review.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to create contact from source link", error)
    return { success: false, error: "Failed to create project contact" }
  }
}

export async function updateProjectContactTypeFromReview(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const projectContactId = requireStringField(formData, "projectContactId")
    const contactType = toWritableContactType(
      requireStringField(formData, "contactType")
    )
    const db = await verifyProjectAccess(projectId, "update")
    const now = new Date().toISOString()
    const isExternal = contactType === "supplier" || contactType === "subcontractor"

    const [contact] = await db
      .select({
        id: projectContacts.id,
        displayName: projectContacts.displayName,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, projectContactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .limit(1)

    if (!contact) return { success: false, error: "Contact not found" }

    await db
      .update(projectContacts)
      .set({
        contactType,
        role:
          contactType === "owner"
            ? "Owner"
            : contactType === "internal"
              ? "Internal"
              : contactType === "supplier"
                ? "Supplier"
                : "Subcontractor",
        companyName: isExternal ? contact.displayName : null,
        subVendorPortalVisible: isExternal,
        internalVisible: true,
        updatedAt: now,
      })
      .where(eq(projectContacts.id, projectContactId))

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update project contact type", error)
    return { success: false, error: "Failed to update project contact" }
  }
}

export async function ignoreContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const linkIds = requireLinkIds(formData)
    const db = await verifyProjectAccess(projectId, "update")

    await db
      .update(projectContactSourceLinks)
      .set({
        projectContactId: null,
        matchStatus: "ignored",
        matchConfidence: 0,
        matchReason: "Ignored in Compass match review.",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to ignore contact source link", error)
    return { success: false, error: "Failed to ignore contact match" }
  }
}

export async function restoreContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const projectId = requireStringField(formData, "projectId")
    const linkIds = requireLinkIds(formData)
    const db = await verifyProjectAccess(projectId, "update")

    const links = await db
      .select({
        id: projectContactSourceLinks.id,
        sourceName: projectContactSourceLinks.sourceName,
      })
      .from(projectContactSourceLinks)
      .where(
        and(
          inArray(projectContactSourceLinks.id, linkIds),
          eq(projectContactSourceLinks.projectId, projectId)
        )
      )

    if (links.length !== linkIds.length) {
      return { success: false, error: "Source link not found" }
    }

    const now = new Date().toISOString()
    for (const link of links) {
      const restoredStatus = /\b(tbd|to\s+be\s+determined)\b/i.test(link.sourceName)
        ? "pending_assignment"
        : "unmatched"

      await db
        .update(projectContactSourceLinks)
        .set({
          projectContactId: null,
          matchStatus: restoredStatus,
          matchConfidence: 0,
          matchReason:
            restoredStatus === "pending_assignment"
              ? "Pending assignment. TBD means To Be Determined and should not match Sage until a real subcontractor or supplier is selected."
              : "Restored from ignored status in Compass match review.",
          updatedAt: now,
        })
        .where(eq(projectContactSourceLinks.id, link.id))
    }

    revalidateContactPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to restore contact source link", error)
    return { success: false, error: "Failed to restore contact match" }
  }
}
