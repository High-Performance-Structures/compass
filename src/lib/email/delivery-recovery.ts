/** Only explicit provider rejections are safe to retry automatically. */
export function emailRetryAt(input: {
  readonly error: string | null
  readonly retryAfter: string | null
  readonly now: Date
  readonly attempt: number
}): string {
  const delay = Math.min(3_600_000, 60_000 * 2 ** Math.min(input.attempt, 6))
  const backoff = input.now.getTime() + delay
  const serverDate = /Retry after\s+(\d{4}-\d\d-\d\dT[\d:.]+Z)/i.exec(input.error ?? "")?.[1]
  const serverTime = serverDate ? Date.parse(serverDate) : Number.NaN
  const headerSeconds = Number(input.retryAfter)
  const headerTime = input.retryAfter
    ? Number.isFinite(headerSeconds)
      ? input.now.getTime() + headerSeconds * 1000
      : Date.parse(input.retryAfter)
    : Number.NaN
  // A small margin avoids sending at the provider's exact reset boundary.
  return new Date(Math.max(backoff, Number.isFinite(serverTime) ? serverTime + 5_000 : 0,
    Number.isFinite(headerTime) ? headerTime + 5_000 : 0)).toISOString()
}

export function isEmailRateLimit(status: number, error: string): boolean {
  return status === 429 || (status === 403 && /"(?:userRateLimitExceeded|rateLimitExceeded)"/.test(error))
}

export function invitationEmailNotice(status: string, nextAttemptAt: string | null): string | null {
  if (status === "sent") return null
  if (status === "queued" || status === "retrying" || status === "sending") {
    return nextAttemptAt
      ? "Project access is prepared. The welcome email is queued and will retry automatically after the email provider's cooldown. You do not need to resend the invitation."
      : "Project access is prepared. The welcome email is queued for automatic delivery. You do not need to resend the invitation."
  }
  if (status === "unknown") {
    return "Project access is prepared, but email delivery could not be confirmed. Check the sending mailbox before resending to avoid a duplicate."
  }
  if (status === "cancelled") return "The queued welcome email was cancelled because the invitation or contact changed. Review project access before inviting again."
  return "Project access is prepared, but the welcome email failed. Review the recipient and email configuration, then retry the invitation."
}
