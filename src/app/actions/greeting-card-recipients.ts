"use server"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  customers,
  organizationMembers,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  buildGreetingCardRecipientOption,
  type GreetingCardRecipientOption,
} from "@/lib/greeting-cards/recipient-directory"
import { requireOrg } from "@/lib/org-scope"
import {
  canApproveGreetingCards,
  canPrepareGreetingCards,
} from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export type { GreetingCardRecipientOption } from "@/lib/greeting-cards/recipient-directory"

type RecipientResult =
  | {
      readonly success: true
      readonly data: readonly GreetingCardRecipientOption[]
    }
  | { readonly success: false; readonly error: string }

export async function getGreetingCardRecipientOptions(): Promise<RecipientResult> {
  try {
    const user = await requireAuth()
    if (!canPrepareGreetingCards(user) && !canApproveGreetingCards(user)) {
      return {
        success: false,
        error: "Employee greeting-card access is required.",
      }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return {
        success: false,
        error: "Compass storage is not available right now.",
      }
    }
    const db = getDb(env.DB)

    const [customerRows, vendorRows, vendorContactRows, teamRows] =
      await Promise.all([
        db
          .select({
            id: customers.id,
            name: customers.name,
            company: customers.company,
            address: customers.address,
          })
          .from(customers)
          .where(eq(customers.organizationId, organizationId)),
        db
          .select({
            id: vendors.id,
            name: vendors.name,
            category: vendors.category,
            address: vendors.address,
          })
          .from(vendors)
          .where(
            and(
              eq(vendors.organizationId, organizationId),
              eq(vendors.directoryStatus, "active"),
            ),
          ),
        db
          .select({
            id: vendorContacts.id,
            name: vendorContacts.name,
            vendorName: vendors.name,
            vendorCategory: vendors.category,
            vendorAddress: vendors.address,
          })
          .from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(
            and(
              eq(vendors.organizationId, organizationId),
              eq(vendors.directoryStatus, "active"),
              eq(vendorContacts.active, true),
            ),
          ),
        db
          .select({
            id: users.id,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            address: users.address,
            role: organizationMembers.role,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(users.isActive, true),
            ),
          ),
      ])

    const options: GreetingCardRecipientOption[] = []
    for (const row of customerRows) {
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "customer",
          displayName: row.name,
          companyName: row.company,
          address: row.address,
          recipientType: "client",
          personName: true,
        }),
      )
    }
    for (const row of vendorRows) {
      if (row.category.toLowerCase().includes("internal")) continue
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "vendor",
          displayName: row.name,
          companyName: row.name,
          address: row.address,
          recipientType: vendorRecipientType(row.category),
          personName: false,
        }),
      )
    }
    for (const row of vendorContactRows) {
      if (row.vendorCategory.toLowerCase().includes("internal")) continue
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "vendor_contact",
          displayName: row.name,
          companyName: row.vendorName,
          address: row.vendorAddress,
          recipientType: vendorRecipientType(row.vendorCategory),
          personName: true,
        }),
      )
    }
    for (const row of teamRows) {
      if (!isInternalStaffRole(row.role)) continue
      const fullName = [row.firstName, row.lastName]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ")
      options.push(
        buildGreetingCardRecipientOption({
          id: row.id,
          sourceType: "team",
          displayName: row.displayName?.trim() || fullName || row.email,
          companyName: null,
          address: row.address,
          recipientType: "employee",
          personName: true,
          firstName: row.firstName,
          lastName: row.lastName,
        }),
      )
    }

    return {
      success: true,
      data: options.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load saved greeting-card recipients.",
    }
  }
}

function vendorRecipientType(category: string): "subcontractor" | "supplier" {
  return category.toLowerCase().includes("subcontractor")
    ? "subcontractor"
    : "supplier"
}
