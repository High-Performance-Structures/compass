import type { RfiVendorAssignment } from "@/lib/rfis/vendor-assignment"

/** RFI records as the project RFI pages read them. */

export type ProjectRfiAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageUrl: string | null
  readonly storageStatus: string
}

export type ProjectRfiInboundEmailItem = {
  readonly id: string
  readonly rfiId: string
  readonly from: string
  readonly subject: string
  readonly body: string
  readonly receivedAt: string
}

export type ProjectRfiItem = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly priority: string
  readonly audience: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly answeredAt: string | null
  readonly attachmentCount: number
  readonly attachments: readonly ProjectRfiAttachmentItem[]
  /** Staff only: the vendor company that can see this RFI; null for externals. */
  readonly assignedVendor: RfiVendorAssignment | null
}

export type ProjectRfiSummary = {
  readonly totalCount: number
  readonly openCount: number
  readonly highPriorityCount: number
  readonly subVendorVisibleCount: number
  readonly ownerVisibleCount: number
  readonly nextDue: ProjectRfiItem | null
  readonly items: readonly ProjectRfiItem[]
}

export type ProjectRfiAttachmentInput = {
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageProvider: string
  readonly storageId: string | null
  readonly storageUrl: string | null
}

export type CreateProjectRfiInput = {
  readonly subject: string
  readonly question: string
  readonly priority: string
  readonly audience: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  /** Active subcontractor/supplier project contact whose company may see the RFI. */
  readonly assignedVendorContactId: string | null
  readonly attachments: readonly ProjectRfiAttachmentInput[]
}

export type UpdateProjectRfiInput = {
  readonly answer: string | null
  readonly status: string
  readonly audience: string
  readonly mentionedUserIds?: readonly string[]
}
