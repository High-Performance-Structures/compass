export type CorrespondenceResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

export type SendCorrespondenceResult =
  | { readonly success: true; readonly data: { readonly conversationId: string; readonly messageId: string } }
  | { readonly success: false; readonly error: string; readonly retry: "edit" | "same_request" }

export type CorrespondencePerson = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: "staff" | "owner" | "sub_vendor"
  readonly delivery: "compass"
}
export type CorrespondenceSummary = {
  readonly id: string
  readonly projectId: string
  readonly subject: string
  readonly excerpt: string
  readonly lastActivityAt: string
  readonly lastActivityDisplay?: string | null
  readonly lastActivitySourceLocal?: boolean
  readonly people: readonly CorrespondencePerson[]
  readonly unread: boolean
  readonly saved: boolean
  readonly followUp: boolean
  readonly archived: boolean
  readonly closed: boolean
  readonly shareReadReceipts: boolean
}
export type CorrespondenceAttachment = {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly contentType: string
  readonly available: boolean
}
export type CorrespondenceMessage = {
  readonly id: string
  readonly sequence: number
  readonly source: "compass" | "buildertrend" | "email" | "sms"
  readonly authorName: string
  readonly authorUserId: string | null
  readonly sentAt: string
  readonly sourceSentDisplay?: string | null
  readonly sourceSentAt?: string | null
  readonly sourceAttachmentReadiness?: {
    readonly expectedRecoverableFileCount: number
    readonly linkedAttachmentCount: number
    readonly pendingFileCount: number
  } | null
  readonly body: string
  readonly recipients: readonly { readonly name: string; readonly kind: "to" | "cc" }[]
  readonly attachments: readonly CorrespondenceAttachment[]
  readonly editedAt: string | null
  readonly retractedAt: string | null
  readonly delivery: "saved" | "imported"
  readonly canEdit: boolean
  readonly readReceipts: readonly { readonly userId: string; readonly name: string; readonly status: "opened" | "not_opened" | "unavailable"; readonly openedAt: string | null }[]
}
export type CorrespondenceDetail = {
  readonly conversation: CorrespondenceSummary
  readonly participantVersion: number
  readonly messages: readonly CorrespondenceMessage[]
  readonly hasEarlier: boolean
  readonly draft: { readonly body: string; readonly version: number } | null
}
export type CorrespondenceCompositionDraft = {
  readonly subject: string
  readonly body: string
  readonly recipientUserIds: readonly string[]
  readonly version: number
}
export type CorrespondenceInbox = {
  readonly compositionDraft: CorrespondenceCompositionDraft | null
  readonly viewerId: string
  readonly projectName: string
  readonly workspace: "staff" | "owner" | "sub_vendor"
  readonly conversations: readonly CorrespondenceSummary[]
  readonly contacts: readonly CorrespondencePerson[]
}
export type SendCorrespondenceInput = {
  readonly projectId: string
  readonly conversationId: string | null
  readonly subject: string
  readonly recipientUserIds: readonly string[]
  readonly body: string
  readonly idempotencyKey: string
  readonly participantVersion: number | null
  readonly attachmentIds: readonly string[]
}
export type CorrespondenceStateInput = {
  readonly saved: boolean
  readonly followUp: boolean
  readonly archived: boolean
}

export type CorrespondenceInboxFilter = "inbox" | "unread" | "follow-up" | "saved" | "archived"

export type ProjectMessageHistoryPage = {
  readonly projectName: string
  readonly viewerId: string
  readonly conversations: readonly {
    readonly id: string
    readonly subject: string
    readonly authorName: string
    readonly excerpt: string
    readonly sentAt: string
    readonly sourceSentDisplay: string | null
    readonly sourceSentAt: string | null
  }[]
  readonly nextCursor: { readonly sentAt: string; readonly conversationId: string } | null
}
