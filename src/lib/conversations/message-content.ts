const MENTION_SPAN_PATTERN =
  /<span\b(?=[^>]*\bdata-type=(["'])mention\1)[^>]*>([^<]*)<\/span>/gi

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
}

function decodeBasicHtmlEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity
  )
}

/**
 * TipTap Markdown serializes custom mention nodes as HTML. Conversations store
 * Markdown, so convert only those known mention spans back to their visible
 * text before saving or rendering legacy messages.
 */
export function normalizeConversationMentions(content: string): string {
  return content.replace(
    MENTION_SPAN_PATTERN,
    (_match, _quote, label: string) => decodeBasicHtmlEntities(label)
  )
}
