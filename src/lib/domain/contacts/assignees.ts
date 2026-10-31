import { and, asc, eq, isNull } from "drizzle-orm"

import { customers, organizationMembers, projectContacts, users, vendorContacts, vendors } from "@/db/schema"
import { isDirectoryAssignable, vendorCategoryToContactType } from "@/lib/contact-project-association"
import { uniqueInternalStaffMembers } from "@/lib/internal-contact-directory"
import type { Db } from "@/lib/server/action-context"

import {
  customerToTaskAssigneeOption,
  directoryContactToTaskAssigneeOption,
  normalizeDirectoryKey,
  normalizeEmailKey,
  organizationUserToTaskAssigneeOption,
  projectContactToTaskAssigneeOption,
  sourceIdPart,
  toContactItem,
  vendorPersonToTaskAssigneeOption,
} from "./rules"
import { insertProjectContact, resolvedProjectContacts } from "./store"
import type { AddTaskAssigneeContactResult, ProjectTaskAssigneeOption, ProjectTaskAssigneeOptions } from "./types"

type Scope = { readonly organizationId: string; readonly projectId: string }

function activeProjectContacts(db: Db, scope: Scope, where = eq(projectContacts.active, true)) {
  return resolvedProjectContacts(db, { ...scope, where, order: "type_then_name" })
}

function activeOrganizationUsers(db: Db, organizationId: string) {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.email))
}

/**
 * Task assignees: the project's contacts and staff first, then directory
 * vendors that are not already on the project (by id or company name).
 */
export async function loadProjectTaskAssigneeOptions(
  db: Db,
  scope: Scope & { readonly grants: { readonly vendors: boolean; readonly internal: boolean } }
): Promise<ProjectTaskAssigneeOptions> {
  const projectContactItems = (await activeProjectContacts(db, scope)).map((row) => toContactItem(row))
  const projectSourceVendorIds = new Set(
    projectContactItems
      .map((contact) => contact.vendorId ?? (contact.sourceEntityType === "vendor" ? contact.sourceEntityId : null))
      .filter((value): value is string => value !== null)
  )
  const projectNameKeys = new Set(
    projectContactItems.map((contact) => normalizeDirectoryKey(contact.companyName ?? contact.displayName))
  )
  const projectAssigneeNameKeys = new Set(projectContactItems.map((contact) => normalizeDirectoryKey(contact.displayName)))
  const projectEmailKeys = new Set(
    projectContactItems.map((contact) => normalizeEmailKey(contact.email)).filter((email) => email.length > 0)
  )

  const organizationUserRows = scope.grants.internal ? await activeOrganizationUsers(db, scope.organizationId) : []
  const organizationUserOptions = organizationUserRows
    .map(organizationUserToTaskAssigneeOption)
    .filter(
      (option) =>
        !projectAssigneeNameKeys.has(normalizeDirectoryKey(option.name)) &&
        !projectEmailKeys.has(normalizeEmailKey(option.email))
    )

  const directoryRows = scope.grants.vendors
    ? await db
        .select({
          id: vendors.id,
          name: vendors.name,
          category: vendors.category,
          email: vendors.email,
          phone: vendors.phone,
        })
        .from(vendors)
        .where(and(eq(vendors.organizationId, scope.organizationId), eq(vendors.directoryStatus, "active")))
        .orderBy(asc(vendors.name))
    : []
  const directoryContacts = directoryRows
    .filter(
      (vendor) =>
        isDirectoryAssignable(vendor.category) &&
        !projectSourceVendorIds.has(vendor.id) &&
        !projectNameKeys.has(normalizeDirectoryKey(vendor.name))
    )
    .map(directoryContactToTaskAssigneeOption)

  return {
    projectContacts: [...projectContactItems.map(projectContactToTaskAssigneeOption), ...organizationUserOptions],
    directoryContacts,
  }
}

/**
 * Schedule assignments intentionally use the complete organization directory.
 * Project contact membership does not narrow these choices; it only supplies
 * additional project-only contacts that may not have a directory record yet.
 */
export async function loadScheduleTaskAssigneeOptions(
  db: Db,
  scope: Scope & {
    readonly grants: { readonly customers: boolean; readonly vendors: boolean; readonly internal: boolean }
  }
): Promise<ProjectTaskAssigneeOptions> {
  const orgId = scope.organizationId
  const [projectContactRows, customerRows, vendorRows, vendorContactRows, organizationUserRows] = await Promise.all([
    activeProjectContacts(db, scope),
    scope.grants.customers
      ? db
          .select({
            id: customers.id,
            name: customers.name,
            company: customers.company,
            email: customers.email,
            phone: customers.phone,
          })
          .from(customers)
          .where(and(eq(customers.organizationId, orgId), isNull(customers.mergedIntoCustomerId)))
          .orderBy(asc(customers.name))
      : [],
    scope.grants.vendors
      ? db
          .select({
            id: vendors.id,
            name: vendors.name,
            category: vendors.category,
            email: vendors.email,
            phone: vendors.phone,
          })
          .from(vendors)
          .where(and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active")))
          .orderBy(asc(vendors.name))
      : [],
    scope.grants.vendors
      ? db
          .select({
            id: vendorContacts.id,
            vendorName: vendors.name,
            category: vendors.category,
            name: vendorContacts.name,
            email: vendorContacts.email,
            phone: vendorContacts.phone,
          })
          .from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(
            and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active"), eq(vendorContacts.active, true))
          )
          .orderBy(asc(vendors.name), asc(vendorContacts.name))
      : [],
    scope.grants.internal
      ? db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
            role: organizationMembers.role,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(and(eq(organizationMembers.organizationId, orgId), eq(users.isActive, true)))
          .orderBy(asc(users.displayName), asc(users.email))
      : [],
  ])

  const projectOptions = projectContactRows.map((row) => toContactItem(row)).map(projectContactToTaskAssigneeOption)
  const teamOptions = uniqueInternalStaffMembers(organizationUserRows).map(organizationUserToTaskAssigneeOption)
  const customerOptions = customerRows.map(customerToTaskAssigneeOption)
  const vendorOptions = vendorRows.map(directoryContactToTaskAssigneeOption)
  const vendorPersonOptions = vendorContactRows.map(vendorPersonToTaskAssigneeOption)

  return {
    projectContacts: [...projectOptions, ...teamOptions],
    directoryContacts: [...customerOptions, ...vendorOptions, ...vendorPersonOptions].sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
  }
}

/** Purchase-order site contacts: the project's internal contacts, then staff with phone numbers. */
export async function loadPurchaseOrderSiteContactOptions(
  db: Db,
  scope: Scope & { readonly grants: { readonly internal: boolean } }
): Promise<readonly ProjectTaskAssigneeOption[]> {
  const projectRows = await resolvedProjectContacts(db, {
    ...scope,
    where: and(eq(projectContacts.contactType, "internal"), eq(projectContacts.active, true)),
    order: "name",
  })
  const projectOptions = projectRows.map((row) => toContactItem(row)).map(projectContactToTaskAssigneeOption)
  const projectNameKeys = new Set(projectOptions.map((option) => normalizeDirectoryKey(option.name)))
  const projectEmailKeys = new Set(
    projectOptions.map((option) => normalizeEmailKey(option.email)).filter((email) => email.length > 0)
  )

  const organizationRows = scope.grants.internal
    ? await db
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
        .where(and(eq(organizationMembers.organizationId, scope.organizationId), eq(users.isActive, true)))
        .orderBy(asc(users.displayName), asc(users.email))
    : []
  const organizationOptions = organizationRows
    .map((row) => ({ ...organizationUserToTaskAssigneeOption(row), phone: row.phone }))
    .filter(
      (option) =>
        !projectNameKeys.has(normalizeDirectoryKey(option.name)) &&
        !projectEmailKeys.has(normalizeEmailKey(option.email))
    )

  return [...projectOptions, ...organizationOptions]
}

/** Put a directory vendor on the project so a task can be assigned to it. */
export async function addDirectoryVendorForTask(
  db: Db,
  scope: Scope & { readonly vendorId: string }
): Promise<AddTaskAssigneeContactResult> {
  const [vendor] = await db
    .select()
    .from(vendors)
    .where(
      and(eq(vendors.id, scope.vendorId), eq(vendors.organizationId, scope.organizationId), eq(vendors.directoryStatus, "active"))
    )
    .limit(1)

  if (!vendor) return { success: false, error: "Directory contact not found" }
  if (!isDirectoryAssignable(vendor.category)) {
    return { success: false, error: "This directory contact is not assignable" }
  }

  const [existing] = await resolvedProjectContacts(db, {
    ...scope,
    where: and(eq(projectContacts.sourceEntityType, "vendor"), eq(projectContacts.sourceEntityId, vendor.id)),
    order: "type_then_name",
  })
  if (existing) {
    return { success: true, contact: projectContactToTaskAssigneeOption(toContactItem(existing)) }
  }

  const now = new Date().toISOString()
  const contactType = vendorCategoryToContactType(vendor.category)
  const role = contactType === "supplier" ? "Supplier" : contactType === "internal" ? "Internal" : "Subcontractor"
  const contactId = `project-contact-${sourceIdPart(scope.projectId)}-${sourceIdPart(contactType)}-${sourceIdPart(vendor.id)}`

  await insertProjectContact(db, {
    id: contactId,
    projectId: scope.projectId,
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
    notes: "Added from task assignment in Compass. Portal visibility should be reviewed separately.",
    ownerPortalVisible: false,
    subVendorPortalVisible: false,
    internalVisible: true,
    primaryContact: false,
    active: true,
    sortOrder: 850,
    syncStatus: vendor.syncStatus === "needs_sage_review" ? "needs_sage_review" : "synced",
    lastSyncedAt: vendor.lastSyncedAt ?? now,
    createdAt: now,
    updatedAt: now,
  })

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
}
