import type { CompositionContent } from "./types"
export function compositionHasContent(content: CompositionContent): boolean {
  return Boolean(content.subject.trim() || content.body.trim() || content.attachmentIds.length || (content.kind === "message" ? content.recipientUserIds.length : content.to.length + content.cc.length + content.bcc.length))
}
