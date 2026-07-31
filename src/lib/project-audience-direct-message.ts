import type {
  AudienceContact,
  AudienceMessageChannel,
} from "@/app/actions/project-audience-preview"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { projectAudienceConversationHref } from "@/lib/project-audience-preview-routes"

export type ProjectAudienceMessageRecipient = {
  readonly userId: string
  readonly displayName: string
  readonly role: string | null
}

export type ProjectAudienceMessageShortcut = {
  readonly conversationHref: string
  readonly recipients: readonly ProjectAudienceMessageRecipient[]
}

export function projectAudienceMessageShortcut(input: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly viewerId: string
  readonly contacts: readonly AudienceContact[]
  readonly messageChannels: readonly AudienceMessageChannel[]
}): ProjectAudienceMessageShortcut | null {
  const channel = input.messageChannels.find((item) => item.isPrivate)
  if (!channel) return null

  // getProjectAudiencePreview already limits contacts to active, explicitly
  // assigned internal project-team members. Keep this helper structural so the
  // header can never broaden that server-authorized directory.
  const recipientsByUserId = new Map<
    string,
    ProjectAudienceMessageRecipient
  >()
  for (const contact of input.contacts) {
    if (
      !contact.userId ||
      contact.userId === input.viewerId ||
      recipientsByUserId.has(contact.userId)
    ) {
      continue
    }
    recipientsByUserId.set(contact.userId, {
      userId: contact.userId,
      displayName: contact.displayName,
      role: contact.role,
    })
  }
  const recipients = Array.from(recipientsByUserId.values())
  if (recipients.length === 0) return null

  return {
    conversationHref: projectAudienceConversationHref(
      input.projectId,
      input.audience === "owner" ? "owner" : "sub-vendor",
      channel.id
    ),
    recipients,
  }
}

export function projectAudienceMessageRecipientHref(
  conversationHref: string,
  recipient: ProjectAudienceMessageRecipient
): string {
  const query = new URLSearchParams({
    mention: recipient.userId,
    label: recipient.displayName,
  })
  return `${conversationHref}?${query.toString()}`
}
