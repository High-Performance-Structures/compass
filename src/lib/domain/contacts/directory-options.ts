import { and, eq, isNull } from "drizzle-orm"

import { customerContacts, customers, internalContacts, projectContacts, vendorContacts, vendors } from "@/db/schema"
import { vendorCategoryToContactType } from "@/lib/contact-project-association"
import { activeDirectoryIdentityKeys } from "@/lib/contact-identity-ownership"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import type { Db } from "@/lib/server/action-context"

import { byPrimaryThenName } from "./rules"
import type {
  ProjectContactCostCodeOption,
  ProjectContactDirectoryOption,
  ProjectContactDivisionOption,
  ProjectContactSageOptions,
  ProjectDirectoryPersonOption,
} from "./types"

type DirectoryGrants = {
  readonly customers: boolean
  readonly vendors: boolean
  readonly internal: boolean
}

async function existingProjectSources(
  db: Db,
  projectId: string
): Promise<{ readonly sources: ReadonlySet<string>; readonly internalIds: ReadonlySet<string> }> {
  const rows = await db
    .select({
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
      internalContactId: projectContacts.internalContactId,
    })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
  return {
    sources: new Set(
      rows
        .filter((row) => row.sourceEntityId !== null && row.sourceEntityId.length > 0)
        .map((row) => `${row.sourceEntityType}:${row.sourceEntityId}`)
    ),
    internalIds: new Set(rows.flatMap((row) => (row.internalContactId ? [row.internalContactId] : []))),
  }
}

/**
 * The organization-wide directory a project contact may be chosen from.
 * Each directory is read only when the caller's grants allow it.
 */
export async function loadProjectContactDirectoryOptions(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly grants: DirectoryGrants }
): Promise<readonly ProjectContactDirectoryOption[]> {
  const { organizationId: orgId, grants } = input
  const existing = await existingProjectSources(db, input.projectId)
  const [customerRows, customerContactRows, vendorRows, vendorContactRows, teamRows] = await Promise.all([
    grants.customers
      ? db
          .select({
            id: customers.id,
            name: customers.name,
            company: customers.company,
            email: customers.email,
            phone: customers.phone,
            address: customers.address,
          })
          .from(customers)
          .where(and(eq(customers.organizationId, orgId), isNull(customers.mergedIntoCustomerId)))
      : [],
    grants.customers
      ? db
          .select({
            id: customerContacts.id,
            customerId: customerContacts.customerId,
            name: customerContacts.name,
            title: customerContacts.title,
            email: customerContacts.email,
            phone: customerContacts.phone,
            isPrimary: customerContacts.isPrimary,
          })
          .from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(
            and(
              eq(customers.organizationId, orgId),
              isNull(customers.mergedIntoCustomerId),
              eq(customerContacts.active, true)
            )
          )
      : [],
    grants.vendors
      ? db
          .select({
            id: vendors.id,
            name: vendors.name,
            category: vendors.category,
            email: vendors.email,
            phone: vendors.phone,
            address: vendors.address,
          })
          .from(vendors)
          .where(and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active")))
      : [],
    grants.vendors
      ? db
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
          )
      : [],
    grants.internal
      ? db
          .select({
            id: internalContacts.id,
            name: internalContacts.name,
            email: internalContacts.email,
            phone: internalContacts.phone,
            userId: internalContacts.userId,
          })
          .from(internalContacts)
          .where(and(eq(internalContacts.organizationId, orgId), eq(internalContacts.active, true)))
      : [],
  ])
  const directoryIdentityKeys = await activeDirectoryIdentityKeys({
    db,
    organizationId: orgId,
    entityIds: customerRows
      .map((row) => row.id)
      .concat(customerContactRows.map((row) => row.id))
      .concat(vendorRows.map((row) => row.id))
      .concat(vendorContactRows.map((row) => row.id)),
  })
  const peopleBy = (
    rows: readonly (Omit<ProjectDirectoryPersonOption, "identityManagedByActiveUser"> & { readonly ownerId: string })[],
    keyType: "customer_contact" | "vendor_contact"
  ): ReadonlyMap<string, ProjectDirectoryPersonOption[]> => {
    const byOwner = new Map<string, ProjectDirectoryPersonOption[]>()
    for (const { ownerId, ...person } of rows) {
      const current = byOwner.get(ownerId) ?? []
      current.push({ ...person, identityManagedByActiveUser: directoryIdentityKeys.has(`${keyType}:${person.id}`) })
      byOwner.set(ownerId, current)
    }
    return byOwner
  }
  const contactsByCustomer = peopleBy(
    customerContactRows.map(({ customerId, ...person }) => ({ ...person, ownerId: customerId })),
    "customer_contact"
  )
  const contactsByVendor = peopleBy(
    vendorContactRows.map(({ vendorId, ...person }) => ({ ...person, ownerId: vendorId })),
    "vendor_contact"
  )

  const customerOptions: ProjectContactDirectoryOption[] = customerRows.map((row) => ({
    id: row.id,
    sourceType: "customer",
    displayName: row.name,
    companyName: row.company,
    email: row.email,
    phone: row.phone,
    address: row.address,
    suggestedContactType: "owner",
    identityManagedByActiveUser: directoryIdentityKeys.has(`customer:${row.id}`),
    customerContacts: [...(contactsByCustomer.get(row.id) ?? [])].sort(byPrimaryThenName),
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
      identityManagedByActiveUser: directoryIdentityKeys.has(`vendor:${row.id}`),
      customerContacts: [],
      vendorContacts: [...(contactsByVendor.get(row.id) ?? [])].sort(byPrimaryThenName),
    }))
  const teamOptions: ProjectContactDirectoryOption[] = teamRows.map((row) => ({
    id: row.id,
    sourceType: "team",
    displayName: row.name,
    companyName: null,
    email: row.email,
    phone: row.phone,
    address: null,
    suggestedContactType: "internal",
    identityManagedByActiveUser: true,
    customerContacts: [],
    vendorContacts: [],
    alreadyOnProject:
      existing.internalIds.has(row.id) ||
      existing.sources.has(`internal_contact:${row.id}`) ||
      (row.userId !== null && existing.sources.has(`user:${row.userId}`)),
  }))

  return [...customerOptions, ...vendorOptions, ...teamOptions].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  )
}

/** CSI divisions and cost codes a project contact can be filed under. */
export async function loadProjectContactSageOptions(db: Db, projectId: string): Promise<ProjectContactSageOptions> {
  const rows = await loadProjectCostCodeChoices(db, projectId)

  const divisions = new Map<string, ProjectContactDivisionOption>()
  const costCodes = new Map<string, ProjectContactCostCodeOption>()
  for (const row of rows) {
    const description = row.code === `${row.divisionCode} 00 00` ? row.divisionDescription : row.description
    divisions.set(row.divisionCode, {
      value: row.divisionCode,
      label: `${row.divisionCode} 00 00 - ${row.divisionDescription}`,
      name: row.divisionDescription,
    })
    costCodes.set(row.code, {
      value: row.code,
      onBudget: row.onBudget,
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
