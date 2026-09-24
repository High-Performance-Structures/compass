"use server"

import { requireAuth } from "@/lib/auth"
import { getEffectivePermissionAccessLevel } from "@/lib/permission-enforcement"
import { accessLevelToFeatureActions, can, canManageUserAccess } from "@/lib/permissions"

export type ContactDirectoryAccess = {
  readonly read: boolean
  readonly create: boolean
  readonly edit: boolean
  readonly delete: boolean
}

export async function getContactDirectoryAccess(): Promise<{
  readonly customers: ContactDirectoryAccess
  readonly vendors: ContactDirectoryAccess
  readonly internal: ContactDirectoryAccess
  readonly canManageAccounts: boolean
  readonly canReadSageReview: boolean
  readonly canApproveSageReview: boolean
  readonly canReadEmployeePrivate: boolean
}> {
  const user = await requireAuth()
  const [customers, vendors, internal, sageReview, employeePrivate] = await Promise.all([
    getEffectivePermissionAccessLevel(user, "customers"),
    getEffectivePermissionAccessLevel(user, "vendors"),
    getEffectivePermissionAccessLevel(user, "internal-directory"),
    getEffectivePermissionAccessLevel(user, "sage-contact-review"),
    getEffectivePermissionAccessLevel(user, "employee-contact-private"),
  ])
  const toAccess = (
    featureId: string,
    level: typeof customers,
    resource: "customer" | "vendor" | "user"
  ): ContactDirectoryAccess => {
    const actions = accessLevelToFeatureActions(featureId, level)
    return {
      read: actions.includes("read"),
      create: actions.includes("create"),
      edit: actions.includes("update"),
      delete: actions.includes("delete") && can(user, resource, "delete"),
    }
  }
  return {
    customers: toAccess("customers", customers, "customer"),
    vendors: toAccess("vendors", vendors, "vendor"),
    internal: toAccess("internal-directory", internal, "user"),
    canManageAccounts: canManageUserAccess(user),
    canReadSageReview: accessLevelToFeatureActions("sage-contact-review", sageReview).includes("read"),
    canApproveSageReview: accessLevelToFeatureActions("sage-contact-review", sageReview).includes("approve"),
    canReadEmployeePrivate: accessLevelToFeatureActions("employee-contact-private", employeePrivate).includes("read"),
  }
}
