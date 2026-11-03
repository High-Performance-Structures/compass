/**
 * The source-link review queue: imported source rows (Sage, Buildertrend)
 * matched to project contacts. Staff approve, reassign, ignore or create a
 * contact from each row.
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import { projectContacts, projectContactSourceLinks, vendors } from "@/db/schema"
import { isDirectoryAssignable, vendorCategoryToContactType } from "@/lib/contact-project-association"
import type { Db } from "@/lib/server/action-context"

import {
  isExternalContactType,
  restoredSourceLinkStatus,
  reviewRoleForContactType,
  sourceIdPart,
  toContactItem,
  toSourceLinkItem,
} from "./rules"
import {
  approveSourceLinks,
  insertProjectContact,
  resolvedProjectContacts,
  setSourceLinkMatch,
  updateProjectContactById,
} from "./store"
import type { ContactMatchResult, ProjectContactMatchReview, ProjectContactType } from "./types"

type Scope = { readonly organizationId: string; readonly projectId: string }

// Placeholder directory rows that must never be offered as real companies.
const PLACEHOLDER_DIRECTORY_NAMES: readonly string[] = ["Nu-Tech Systems", "Window Supplier TBD"]

export async function loadProjectContactMatchReview(
  db: Db,
  scope: Scope & { readonly canViewVendors: boolean }
): Promise<ProjectContactMatchReview> {
  const contactRows = await resolvedProjectContacts(db, {
    ...scope,
    where: eq(projectContacts.active, true),
    order: "type_then_name",
  })
  const contacts = contactRows.map((row) => toContactItem(row))
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))

  const [independentContacts, linkRows] = await Promise.all([
    scope.canViewVendors
      ? db
          .select({
            id: vendors.id,
            name: vendors.name,
            category: vendors.category,
            sourceSystem: vendors.sourceSystem,
            syncStatus: vendors.syncStatus,
          })
          .from(vendors)
          .where(and(eq(vendors.organizationId, scope.organizationId), eq(vendors.directoryStatus, "active")))
          .orderBy(asc(vendors.name))
      : [],
    db
      .select()
      .from(projectContactSourceLinks)
      .where(eq(projectContactSourceLinks.projectId, scope.projectId))
      .orderBy(
        asc(projectContactSourceLinks.matchStatus),
        asc(projectContactSourceLinks.sourceName),
        asc(projectContactSourceLinks.sourceLabel)
      ),
  ])

  const links = linkRows.map((link) =>
    toSourceLinkItem(link, link.projectContactId ? contactsById.get(link.projectContactId) : undefined)
  )
  const countStatus = (status: string): number => links.filter((link) => link.matchStatus === status).length

  return {
    projectId: scope.projectId,
    contacts,
    independentContacts: independentContacts
      .filter((contact) => !PLACEHOLDER_DIRECTORY_NAMES.includes(contact.name) && isDirectoryAssignable(contact.category))
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        category: contact.category,
        sourceSystem: contact.sourceSystem,
        syncStatus: contact.syncStatus,
        contactType: vendorCategoryToContactType(contact.category),
      })),
    links,
    matchedCount: countStatus("matched"),
    reviewCount: countStatus("review"),
    unmatchedCount: countStatus("unmatched"),
    pendingAssignmentCount: countStatus("pending_assignment"),
    approvedCount: countStatus("approved"),
    ignoredCount: countStatus("ignored"),
  }
}

function selectedLinks(db: Db, projectId: string, linkIds: readonly string[]) {
  return db
    .select()
    .from(projectContactSourceLinks)
    .where(and(inArray(projectContactSourceLinks.id, [...linkIds]), eq(projectContactSourceLinks.projectId, projectId)))
}

/** Add a directory vendor to the project and match the selected rows to it. */
export async function addIndependentContactFromReview(
  db: Db,
  scope: Scope & { readonly vendorId: string; readonly linkIds: readonly string[] }
): Promise<ContactMatchResult> {
  const [vendor] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, scope.vendorId), eq(vendors.organizationId, scope.organizationId)))
    .limit(1)
  if (!vendor) return { success: false, error: "Directory contact not found" }

  const existing = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, scope.projectId),
        eq(projectContacts.sourceEntityType, "vendor"),
        eq(projectContacts.sourceEntityId, vendor.id)
      )
    )
    .limit(1)

  const contactType = vendorCategoryToContactType(vendor.category)
  const contactId =
    existing[0]?.id ??
    `project-contact-${sourceIdPart(scope.projectId)}-${sourceIdPart(contactType)}-${sourceIdPart(vendor.name)}`
  const now = new Date().toISOString()

  if (!existing[0]) {
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
      syncStatus: vendor.syncStatus === "needs_sage_review" ? "needs_sage_review" : "synced",
      lastSyncedAt: vendor.lastSyncedAt ?? now,
      createdAt: now,
      updatedAt: now,
    })
  }

  await setSourceLinkMatch(db, {
    projectId: scope.projectId,
    linkIds: scope.linkIds,
    match: {
      projectContactId: contactId,
      matchStatus: "matched",
      matchConfidence: 1,
      matchReason: "Added from independent contact directory in Compass match review.",
      updatedAt: now,
    },
  })
  return { success: true }
}

export async function approveSourceLinksForProject(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[] }
): Promise<ContactMatchResult> {
  const links = await selectedLinks(db, input.projectId, input.linkIds)
  if (links.length !== input.linkIds.length) return { success: false, error: "Source link not found" }
  if (links.some((link) => !link.projectContactId)) {
    return { success: false, error: "Choose a contact before approving" }
  }
  await approveSourceLinks(db, { ...input, now: new Date().toISOString() })
  return { success: true }
}

export async function assignSourceLinksToContact(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[]; readonly projectContactId: string }
): Promise<ContactMatchResult> {
  const [contact] = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.id, input.projectContactId),
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.active, true)
      )
    )
    .limit(1)
  if (!contact) return { success: false, error: "Contact not found" }

  const links = await selectedLinks(db, input.projectId, input.linkIds)
  if (links.length !== input.linkIds.length) return { success: false, error: "Source link not found" }

  await setSourceLinkMatch(db, {
    projectId: input.projectId,
    linkIds: input.linkIds,
    match: {
      projectContactId: input.projectContactId,
      matchStatus: "matched",
      matchConfidence: 1,
      matchReason: "Assigned in Compass match review.",
      updatedAt: new Date().toISOString(),
    },
  })
  return { success: true }
}

/** A new project contact, pending Sage review, built from the selected rows. */
export async function createContactFromSourceLinks(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[]; readonly contactType: ProjectContactType }
): Promise<ContactMatchResult> {
  const links = await selectedLinks(db, input.projectId, input.linkIds)
  if (links.length !== input.linkIds.length) return { success: false, error: "Source link not found" }

  const now = new Date().toISOString()
  const link = links[0]
  if (!link) return { success: false, error: "Source link not found" }
  const contactId = crypto.randomUUID()
  const isExternal = isExternalContactType(input.contactType)

  await insertProjectContact(db, {
    id: contactId,
    projectId: input.projectId,
    contactType: input.contactType,
    sourceSystem: "compass_review",
    sourceRecordId: link.id,
    sourceEntityType: "manual_pending_sage",
    sourceEntityId: null,
    displayName: link.sourceName,
    companyName: isExternal ? link.sourceName : null,
    role: reviewRoleForContactType(input.contactType),
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

  await setSourceLinkMatch(db, {
    projectId: input.projectId,
    linkIds: input.linkIds,
    match: {
      projectContactId: contactId,
      matchStatus: "matched",
      matchConfidence: 1,
      matchReason: "Created as a Compass project contact from match review.",
      updatedAt: now,
    },
  })
  return { success: true }
}

export async function changeContactTypeFromReview(
  db: Db,
  input: { readonly projectId: string; readonly projectContactId: string; readonly contactType: ProjectContactType }
): Promise<ContactMatchResult> {
  const now = new Date().toISOString()
  const isExternal = isExternalContactType(input.contactType)
  const [contact] = await db
    .select({ id: projectContacts.id, displayName: projectContacts.displayName })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.id, input.projectContactId),
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.active, true)
      )
    )
    .limit(1)
  if (!contact) return { success: false, error: "Contact not found" }

  await updateProjectContactById(db, {
    contactId: input.projectContactId,
    values: {
      contactType: input.contactType,
      role: reviewRoleForContactType(input.contactType),
      companyName: isExternal ? contact.displayName : null,
      subVendorPortalVisible: isExternal,
      internalVisible: true,
      updatedAt: now,
    },
  })
  return { success: true }
}

export async function ignoreSourceLinks(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[] }
): Promise<ContactMatchResult> {
  await setSourceLinkMatch(db, {
    ...input,
    match: {
      projectContactId: null,
      matchStatus: "ignored",
      matchConfidence: 0,
      matchReason: "Ignored in Compass match review.",
      updatedAt: new Date().toISOString(),
    },
  })
  return { success: true }
}

/** Ignored rows return to the queue; TBD rows wait for assignment. */
export async function restoreSourceLinks(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[] }
): Promise<ContactMatchResult> {
  const links = await selectedLinks(db, input.projectId, input.linkIds)
  if (links.length !== input.linkIds.length) return { success: false, error: "Source link not found" }

  const now = new Date().toISOString()
  const pending = links.filter((link) => restoredSourceLinkStatus(link.sourceName) === "pending_assignment")
  const unmatched = links.filter((link) => restoredSourceLinkStatus(link.sourceName) === "unmatched")
  // One write per resulting status instead of one per row.
  await setSourceLinkMatch(db, {
    projectId: input.projectId,
    linkIds: pending.map((link) => link.id),
    match: {
      projectContactId: null,
      matchStatus: "pending_assignment",
      matchConfidence: 0,
      matchReason:
        "Pending assignment. TBD means To Be Determined and should not match Sage until a real subcontractor or supplier is selected.",
      updatedAt: now,
    },
  })
  await setSourceLinkMatch(db, {
    projectId: input.projectId,
    linkIds: unmatched.map((link) => link.id),
    match: {
      projectContactId: null,
      matchStatus: "unmatched",
      matchConfidence: 0,
      matchReason: "Restored from ignored status in Compass match review.",
      updatedAt: now,
    },
  })
  return { success: true }
}
