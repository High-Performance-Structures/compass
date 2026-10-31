"use server"

import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { contactsProjectContext } from "@/lib/domain/contacts/access"
import { revalidateProjectContactPaths } from "@/lib/domain/contacts/paths"
import {
  addDirectoryVendorForTask,
  loadProjectTaskAssigneeOptions,
  loadPurchaseOrderSiteContactOptions,
  loadScheduleTaskAssigneeOptions,
} from "@/lib/domain/contacts/assignees"
import type {
  AddTaskAssigneeContactResult,
  ProjectTaskAssigneeOption,
  ProjectTaskAssigneeOptions,
} from "@/lib/domain/contacts/types"
import { requireOrg } from "@/lib/org-scope"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"

export async function getProjectTaskAssigneeOptions(
  projectId: string
): Promise<ProjectTaskAssigneeOptions> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "tasks", "update")
  const { db } = await contactsProjectContext(projectId)
  const orgId = requireOrg(user)
  const [canViewVendors, canViewInternal] = await Promise.all([
    canFeature(user, "vendors", "read"),
    canFeature(user, "internal-directory", "read"),
  ])
  return loadProjectTaskAssigneeOptions(db, {
    organizationId: orgId,
    projectId,
    grants: { vendors: canViewVendors, internal: canViewInternal },
  })
}

/**
 * Schedule assignments intentionally use the complete organization directory.
 * Project contact membership does not narrow these choices; it only supplies
 * additional project-only contacts that may not have a directory record yet.
 */
export async function getScheduleTaskAssigneeOptions(
  projectId: string
): Promise<ProjectTaskAssigneeOptions> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "schedule", "update")
  const { db } = await contactsProjectContext(projectId)
  const orgId = requireOrg(user)
  const [canViewCustomers, canViewVendors, canViewInternal] = await Promise.all([
    canFeature(user, "customers", "read"),
    canFeature(user, "vendors", "read"),
    canFeature(user, "internal-directory", "read"),
  ])
  return loadScheduleTaskAssigneeOptions(db, {
    organizationId: orgId,
    projectId,
    grants: { customers: canViewCustomers, vendors: canViewVendors, internal: canViewInternal },
  })
}

export async function getProjectPurchaseOrderSiteContactOptions(
  projectId: string
): Promise<readonly ProjectTaskAssigneeOption[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "purchase-orders", "read")
  const { db } = await contactsProjectContext(projectId)
  const orgId = requireOrg(user)
  const canViewInternal = await canFeature(user, "internal-directory", "read")
  return loadPurchaseOrderSiteContactOptions(db, {
    organizationId: orgId,
    projectId,
    grants: { internal: canViewInternal },
  })
}

export async function addDirectoryContactToProjectForTask(
  projectId: string,
  directoryContactId: string
): Promise<AddTaskAssigneeContactResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "tasks", "update")
    await requireFeaturePermission(user, "vendors", "read")

    const orgId = requireOrg(user)
    const { db } = await contactsProjectContext(projectId, "update")
    const result = await addDirectoryVendorForTask(db, {
      organizationId: orgId,
      projectId,
      vendorId: directoryContactId,
    })
    if (result.success) revalidateProjectContactPaths(projectId)
    return result
  } catch (error) {
    console.error("Failed to add task assignee to project contacts", error)
    return { success: false, error: "Failed to add contact to project" }
  }
}
