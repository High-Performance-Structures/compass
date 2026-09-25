"use server"

import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getProjects } from "@/app/actions/projects"
import { getDb } from "@/db"
import { customers, projectContacts, projects, vendors } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requirePermission } from "@/lib/permissions"
import { isDirectoryAssignable, vendorCategoryToContactType } from "@/lib/contact-project-association"
import { queueProjectContactTrackerRefresh } from "@/lib/project-contact-tracker-refresh"

export type CompanyDirectoryKind = "customer" | "vendor"
type AssociationProject = { readonly id: string; readonly name: string; readonly projectNumber: string | null }
type AssociationResult =
  | { readonly success: true; readonly added: number; readonly existing: number; readonly warning?: string }
  | { readonly success: false; readonly error: string }

export async function getCompanyAssociationProjects(): Promise<readonly AssociationProject[]> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "project-contacts", "update")
    requirePermission(user, "project", "update")
    return (await getProjects()).map((project) => ({
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
    }))
  } catch {
    return []
  }
}

export async function addCompaniesToProject(input: {
  readonly kind: CompanyDirectoryKind
  readonly ids: readonly string[]
  readonly projectId: string
}): Promise<AssociationResult> {
  try {
    const user = await requireAuth()
    const orgId = requireOrg(user)
    if (isDemoUser(user.id) || isDemoOrg(orgId)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "project-contacts", "update")
    await requireFeaturePermission(user, input.kind === "vendor" ? "vendors" : "customers", "read")
    requirePermission(user, "project", "update")

    const ids = Array.from(new Set(input.ids))
    if (
      (input.kind !== "customer" && input.kind !== "vendor") ||
      ids.length === 0 || ids.length > 100 ||
      ids.some((id) => !id.trim() || id.length > 200) ||
      !input.projectId.trim()
    ) return { success: false, error: "Choose 1–100 valid directory records and a project." }

    const visibleProjects = await getProjects()
    if (!visibleProjects.some((project) => project.id === input.projectId)) {
      return { success: false, error: "Project is not available for assignment." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, input.projectId), eq(projects.organizationId, orgId)
    )).get()
    if (!project) return { success: false, error: "Project not found in this organization." }

    const companyRows = input.kind === "vendor"
      ? (await db.select({
          id: vendors.id, name: vendors.name, company: vendors.name,
          category: vendors.category, email: vendors.email, phone: vendors.phone,
          address: vendors.address, syncStatus: vendors.syncStatus,
          lastSyncedAt: vendors.lastSyncedAt,
        }).from(vendors).where(and(
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active"),
          inArray(vendors.id, ids)
        ))).map((vendor) => ({
          id: vendor.id, name: vendor.name, company: vendor.company,
          email: vendor.email, phone: vendor.phone, address: vendor.address,
          contactType: vendorCategoryToContactType(vendor.category),
          assignable: isDirectoryAssignable(vendor.category),
          syncStatus: vendor.syncStatus, lastSyncedAt: vendor.lastSyncedAt,
        }))
      : (await db.select({
          id: customers.id, name: customers.name, company: customers.company,
          email: customers.email, phone: customers.phone, address: customers.address,
        }).from(customers).where(and(
          eq(customers.organizationId, orgId), inArray(customers.id, ids)
        ))).map((customer) => ({
          ...customer, contactType: "owner" as const, assignable: true,
          syncStatus: "manual", lastSyncedAt: null,
        }))

    if (companyRows.length !== ids.length) {
      return { success: false, error: "One or more directory records are unavailable in this organization." }
    }
    if (companyRows.some((company) => !company.assignable || company.contactType === "internal")) {
      return { success: false, error: "Internal, bank, and lender vendors cannot be bulk-added as project contacts." }
    }

    const existingRows = await db.select({
      id: projectContacts.id,
      active: projectContacts.active,
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
      vendorId: projectContacts.vendorId,
      customerId: projectContacts.customerId,
    }).from(projectContacts).where(and(
      eq(projectContacts.projectId, input.projectId),
      isNull(projectContacts.vendorContactId),
      isNull(projectContacts.customerContactId),
      or(
        input.kind === "vendor"
          ? inArray(projectContacts.vendorId, ids)
          : inArray(projectContacts.customerId, ids),
        and(
          eq(projectContacts.sourceEntityType, input.kind),
          inArray(projectContacts.sourceEntityId, ids)
        )
      )
    ))
    if (existingRows.some((row) => !row.active)) {
      return { success: false, error: "An inactive project contact is among the selection. Restore it from Project Contacts before bulk-adding." }
    }
    const existingIds = new Set(existingRows.map((row) =>
      input.kind === "vendor" ? row.vendorId ?? row.sourceEntityId : row.customerId ?? row.sourceEntityId
    ))
    const missing = companyRows.filter((company) => !existingIds.has(company.id))
    const now = new Date().toISOString()

    const inserted = missing.length > 0
      ? await db.insert(projectContacts).values(missing.map((company) => ({
          id: `project-contact-company-${input.projectId}-${input.kind}-${company.id}`,
          projectId: input.projectId,
          contactType: company.contactType,
          sourceSystem: input.kind === "vendor" ? "global_directory" : "customer_directory",
          sourceRecordId: company.id,
          sourceEntityType: input.kind,
          sourceEntityId: company.id,
          vendorId: input.kind === "vendor" ? company.id : null,
          customerId: input.kind === "customer" ? company.id : null,
          displayName: company.name,
          companyName: company.company ?? company.name,
          role: company.contactType === "owner" ? "Owner / Client" : company.contactType === "supplier" ? "Supplier" : "Subcontractor",
          email: company.email,
          phone: company.phone,
          address: company.address,
          ownerPortalVisible: false,
          subVendorPortalVisible: false,
          internalVisible: true,
          active: true,
          sortOrder: 800,
          syncStatus: company.syncStatus,
          lastSyncedAt: company.lastSyncedAt,
          createdAt: now,
          updatedAt: now,
        }))).onConflictDoNothing().returning({ id: projectContacts.id })
      : []

    let warning: string | undefined
    if (inserted.length > 0) {
      try {
        await queueProjectContactTrackerRefresh({ db, organizationId: orgId, projectId: input.projectId })
      } catch (error) {
        console.error("Project contacts were added, but tracker refresh could not be queued", error)
        warning = "Project contacts were added, but the project registry refresh needs attention."
      }
      revalidatePath(`/dashboard/projects/${input.projectId}`)
      revalidatePath(`/dashboard/projects/${input.projectId}/contacts`)
      revalidatePath(`/dashboard/projects/${input.projectId}/information`)
      revalidatePath(`/dashboard/projects/${input.projectId}/rfis`)
      revalidatePath(`/dashboard/projects/${input.projectId}/purchase-orders`)
    }
    return { success: true, added: inserted.length, existing: ids.length - inserted.length, warning }
  } catch (error) {
    console.error("Failed to bulk-associate directory companies with project", error)
    return { success: false, error: "Failed to add directory records to this project." }
  }
}
