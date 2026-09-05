import "server-only"

import type { getDb } from "@/db"
import {
  COMPASS_GMAIL_SEND_SCOPE,
  getCompassGmailAccessToken,
} from "@/lib/email/compass-email"

import type { CorrespondenceEmailSender } from "./email-adapter"

function envString(environment: unknown, key: string): string | null {
  if (!isRecord(environment)) return null
  const value = environment[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function header(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function messageSource(input: {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly replyTo: string
  readonly headers: readonly { readonly name: string; readonly value: string }[]
}): string {
  const custom = input.headers
    .filter((item) => /^[A-Za-z0-9-]+$/.test(item.name))
    .map((item) => `${item.name}: ${header(item.value)}`)
  return [
    `From: ${header(input.from)}`,
    `To: ${header(input.to)}`,
    `Reply-To: ${header(input.replyTo)}`,
    `Subject: ${header(input.subject)}`,
    ...custom,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
  ].join("\r\n")
}

function providerId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null
  return typeof value.id === "string" ? value.id : null
}

/**
 * Strict Gmail sender used by correspondence dispatch. It intentionally does
 * not use the notification provider fallback: an uncertain send remains
 * `unknown` and is never blindly resent.
 */
export function gmailCorrespondenceSender(input: {
  readonly environment: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
}): CorrespondenceEmailSender {
  return async (message) => {
    const access = await getCompassGmailAccessToken({
      env: input.environment,
      db: input.db,
      organizationId: input.organizationId,
      scopes: [COMPASS_GMAIL_SEND_SCOPE],
    })
    if (!access.success) return { kind: "failed", error: access.error }
    const from =
      envString(input.environment, "COMPASS_EMAIL_FROM") ??
      `Compass <${access.sender}>`
    let response: Response
    try {
      response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: base64url(
              messageSource({
                from,
                to: message.to,
                subject: message.subject,
                text: message.text,
                replyTo: message.replyTo,
                headers: message.headers,
              })
            ),
          }),
        }
      )
    } catch (error) {
      return {
        kind: "unknown",
        error: error instanceof Error ? error.message : "Gmail send outcome is unknown.",
      }
    }
    const responseText = await response.text()
    if (!response.ok) return { kind: "failed", error: responseText.slice(0, 500) }
    let id: string | null = null
    try {
      id = providerId(JSON.parse(responseText))
    } catch {
      id = null
    }
    return { kind: "accepted", providerMessageId: id }
  }
}
