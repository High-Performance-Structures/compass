export type FeedbackMessagePart =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "link"; text: string; href: string; external: boolean }>

// Compass paths (such as a help guide) and web links. Trailing sentence
// punctuation stays text so "see /dashboard/help/daily-logs." links cleanly.
const LINK_PATTERN = /(https?:\/\/[^\s<>"]+|\/dashboard\/[A-Za-z0-9\-._~/?#=&%]+)/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/

/** Splits a Feedback Desk update into text and clickable links. */
export function feedbackMessageParts(message: string): readonly FeedbackMessagePart[] {
  const parts: FeedbackMessagePart[] = []
  let cursor = 0
  for (const match of message.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0]
    // A Compass path must start a word, not sit inside another URL or word.
    if (raw.startsWith("/") && start > 0 && /[^\s(]/.test(message[start - 1] ?? "")) continue
    const trailing = TRAILING_PUNCTUATION.exec(raw)?.[0] ?? ""
    const href = raw.slice(0, raw.length - trailing.length)
    if (href.length === 0) continue
    if (start > cursor) parts.push({ kind: "text", text: message.slice(cursor, start) })
    parts.push({ kind: "link", text: href, href, external: !href.startsWith("/") })
    cursor = start + href.length
  }
  if (cursor < message.length) parts.push({ kind: "text", text: message.slice(cursor) })
  return parts
}
