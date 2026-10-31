import type { ProjectAudience } from "@/lib/project-audience-access"
import type { GuestClientMeeting } from "@/lib/client-meetings/guest-meetings"
import type {
  PortalPurchaseOrderAcknowledgement,
  PortalPurchaseOrderStatusUpdate,
} from "@/lib/purchase-orders/portal-response"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import type {
  PortalRfqDocumentLink,
  PortalRfqScopeItem,
  PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

/** Shapes of the owner/vendor project workspace preview (read by actions, print, and portal views). */

export type AudiencePhoto = {
  readonly id: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly photoDate: string | null
  readonly schedulePhase: string
  readonly schedulePhaseConfidence: number
  readonly schedulePhaseReason: string
}

export type AudienceScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly workdays: number
  readonly status: string
  readonly phase: string
  readonly displayColor: string | null
  readonly assignedTo: string | null
  readonly percentComplete: number
  readonly isMilestone: boolean
  readonly confirmationRequired: boolean
  readonly confirmationStatus: string
  readonly viewerCanConfirm: boolean
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly proposalNote: string | null
  readonly proposalSubmittedAt: string | null
  readonly assignees: readonly AudienceScheduleAssignee[]
}

type AudienceScheduleAssignee = {
  readonly id: string
  readonly assignedUserId: string | null
  readonly projectContactId: string | null
  readonly displayName: string | null
  readonly responseStatus: string
  readonly dateResponseStatus: string
  readonly durationResponseStatus: string
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly responseMessage: string | null
  readonly viewerCanRespond: boolean
}

export type AudienceOperationItem = {
  readonly id: string
  readonly sourceRecordType: string
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly acknowledgement: PortalPurchaseOrderAcknowledgement | null
  readonly latestVendorStatus: PortalPurchaseOrderStatusUpdate | null
}

export type AudienceOwnerUpdate = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly summary: string
  readonly publishedAt: string | null
}

export type AudienceProjectOption = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly status: string
}

export type AudienceRfi = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly priority: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly answeredAt: string | null
}

export type AudienceRfq = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly companyName: string | null
  readonly vendorCategory: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly scopeItems: readonly PortalRfqScopeItem[]
  readonly documentLinks: readonly PortalRfqDocumentLink[]
  readonly vendorResponse: PortalRfqVendorResponse | null
}

export type AudienceMessageChannel = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly isPrivate: boolean
}

export type AudienceContact = {
  readonly id: string
  readonly userId: string | null
  readonly contactType: string
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly primaryContact: boolean
}

export type AudienceDocument = {
  readonly id: string
  readonly category: string
  readonly title: string
  readonly description: string | null
  readonly documentDate: string | null
  readonly revision: string | null
  readonly status: string
  readonly downloadable: boolean
  readonly sourceFileName: string
  readonly publishedAt: string | null
}

export type AudienceContractDocument = {
  readonly id: string
  readonly packetNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly executedAt: string | null
  readonly label: string | null
}

export type ProjectAudiencePreview = {
  readonly audience: ProjectAudience
  readonly viewerIsInternal: boolean
  readonly viewer: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly avatarUrl: string | null
    readonly sidebarPhotoUrl: string | null
  }
  readonly projectOptions: readonly AudienceProjectOption[]
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly textPhoneNumber: string
    readonly address: string | null
    readonly clientName: string | null
    readonly projectManager: string | null
    readonly ownerScheduleView: OwnerScheduleView
    readonly schedulePublished: boolean
    readonly warrantyEnabled: boolean
  }
  /** Google Meets the person whose workspace this is was invited to. */
  readonly upcomingMeetings: readonly GuestClientMeeting[]
  readonly ownerUpdates: readonly AudienceOwnerUpdate[]
  readonly photos: readonly AudiencePhoto[]
  readonly contractDocuments: readonly AudienceContractDocument[]
  readonly documents: readonly AudienceDocument[]
  readonly schedulePublicationAvailable: boolean
  readonly scheduleItems: readonly AudienceScheduleItem[]
  readonly operations: readonly AudienceOperationItem[]
  readonly rfis: readonly AudienceRfi[]
  readonly rfqs: readonly AudienceRfq[]
  readonly messageChannels: readonly AudienceMessageChannel[]
  readonly contacts: readonly AudienceContact[]
}
