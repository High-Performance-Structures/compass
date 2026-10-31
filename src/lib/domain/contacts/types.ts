/**
 * Shapes the contacts domain returns to project pages, pickers and the
 * source-link review queue. Type-only, so client components can import it.
 */
import type {
  ProjectContactAccessStatus,
  ProjectContactCompassAccountStatus,
} from "@/lib/project-contact-access-status"

import type { ProjectContactType } from "./statuses"

export type { ProjectContactType }

export type ProjectContactAudience = "internal" | "owner" | "sub_vendor"

export type ProjectContactItem = {
  readonly id: string
  readonly contactType: ProjectContactType
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly customerId: string | null
  readonly customerContactId: string | null
  readonly vendorId: string | null
  readonly vendorContactId: string | null
  readonly internalContactId: string | null
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
  readonly welcomeEmail: { readonly status: string; readonly nextAttemptAt: string | null } | null
  readonly accessStatus: ProjectContactAccessStatus
  readonly compassAccountStatus: ProjectContactCompassAccountStatus
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

type ProjectContactDirectorySource = "customer" | "vendor" | "team"

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
  readonly customerContacts: readonly ProjectDirectoryPersonOption[]
  readonly vendorContacts: readonly ProjectDirectoryPersonOption[]
  readonly alreadyOnProject?: boolean
}

export type ProjectDirectoryPersonOption = {
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
  readonly onBudget?: boolean
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
  readonly customerContactId: string | null
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
