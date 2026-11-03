import type { ReactElement } from "react"

import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { importedConversationContent } from "@/lib/conversations/imported-message-content"
import { normalizeConversationMentions } from "@/lib/conversations/message-content"

type MessageContentProps = {
  readonly id: string
  readonly content: string
  readonly sourceSystem?: string | null
}

export function MessageContent({
  id,
  content,
  sourceSystem,
}: MessageContentProps): ReactElement {
  if (sourceSystem === "buildertrend") {
    // Captured source bodies are literal text, not Compass-authored Markdown.
    // React escapes markup while pre-wrap retains source lines and spaces.
    return <div className="whitespace-pre-wrap">{content}</div>
  }

  return (
    <MarkdownRenderer>
      {normalizeConversationMentions(
        importedConversationContent({ id, content, sourceSystem })
      )}
    </MarkdownRenderer>
  )
}
