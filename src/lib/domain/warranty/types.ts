type WarrantyClaimAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly ownerVisible: boolean
  readonly downloadHref: string
}

type WarrantyClaimEventItem = {
  readonly id: string
  readonly actorName: string
  readonly eventType: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly createdAt: string
}

export type WarrantyClaimItem = {
  readonly id: string
  readonly claimNumber: string
  readonly title: string
  readonly location: string | null
  readonly category: string
  readonly description: string
  readonly priority: string
  readonly status: string
  readonly claimantUserId: string | null
  readonly claimantName: string
  readonly assignedUserId: string | null
  readonly assignedName: string | null
  /** Staff only: the linked Compass contact and vendor (null for owners). */
  readonly assignedProjectContactId: string | null
  readonly assignedVendorId: string | null
  readonly acknowledgedAt: string | null
  readonly scheduledFor: string | null
  readonly workStartedAt: string | null
  readonly resolvedAt: string | null
  readonly ownerConfirmedAt: string | null
  readonly resolutionSummary: string | null
  readonly internalNotes: string | null
  readonly submittedAt: string
  readonly updatedAt: string
  readonly attachments: readonly WarrantyClaimAttachmentItem[]
  readonly events: readonly WarrantyClaimEventItem[]
  readonly viewerCanDelete: boolean
}
