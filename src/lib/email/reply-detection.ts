type ReplyCandidate = {
  readonly inReplyToHeader: string | null
  readonly referencesHeader: string | null
  readonly subject: string
}

export function isReplyMessage(candidate: ReplyCandidate): boolean {
  return Boolean(
    candidate.inReplyToHeader ||
      candidate.referencesHeader ||
      /^\s*(?:re|fw|fwd)\s*:/i.test(candidate.subject)
  )
}
