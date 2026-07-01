import "server-only"

import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import {
  createServiceAccountJWT,
  exchangeJWTForAccessToken,
} from "@/lib/google/auth/service-account"

export type CompassEmailInput = {
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string | null
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly replyTo?: string
  readonly headers?: readonly {
    readonly name: string
    readonly value: string
  }[]
  readonly subject: string
  readonly text: string
  readonly html?: string
}

export type CompassEmailDeliveryResult = {
  readonly status: string
  readonly provider: string
  readonly providerMessageId: string | null
  readonly error: string | null
}

export const COMPASS_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send"
export const COMPASS_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly"
const DEFAULT_COMPASS_EMAIL_FROM = "Compass <compass@hps-colorado.com>"
const DEFAULT_COMPASS_GMAIL_USER = "compass@hps-colorado.com"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function googleConfigEnv(env: unknown): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  if (!isRecord(env)) return values

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") values[key] = value
  }

  return values
}

function escapeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function safeHeaderName(value: string): string | null {
  const name = value.trim()
  return /^[A-Za-z0-9-]+$/.test(name) ? name : null
}

function extractEmailAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value)
  return (match?.[1] ?? value).trim()
}

function base64urlString(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function mimeBoundary(): string {
  return `compass-${crypto.randomUUID()}`
}

function buildMimeMessage(input: {
  readonly from: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly replyTo: string | null
  readonly headers: readonly {
    readonly name: string
    readonly value: string
  }[]
  readonly subject: string
  readonly text: string
  readonly html: string | null
}): string {
  const customHeaders = input.headers
    .map((header) => {
      const name = safeHeaderName(header.name)
      return name ? `${name}: ${escapeHeader(header.value)}` : null
    })
    .filter((line): line is string => line !== null)
  const headers = [
    `From: ${escapeHeader(input.from)}`,
    `To: ${input.to.map(escapeHeader).join(", ")}`,
    input.cc.length > 0 ? `Cc: ${input.cc.map(escapeHeader).join(", ")}` : null,
    input.replyTo ? `Reply-To: ${escapeHeader(input.replyTo)}` : null,
    `Subject: ${escapeHeader(input.subject)}`,
    ...customHeaders,
    "MIME-Version: 1.0",
  ].filter((line): line is string => line !== null)

  if (!input.html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.text,
    ].join("\r\n")
  }

  const boundary = mimeBoundary()
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
    `--${boundary}--`,
    "",
  ].join("\r\n")
}

function providerMessageId(value: unknown): string | null {
  if (!isRecord(value)) return null
  const id = value.id
  if (typeof id === "string") return id
  const messageId = value.messageId
  return typeof messageId === "string" ? messageId : null
}

async function getGoogleServiceAccountKey(input: {
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string | null
}): Promise<string | null> {
  const config = getGoogleConfig(googleConfigEnv(input.env))
  const query = input.organizationId
    ? input.db
        .select()
        .from(googleAuth)
        .where(eq(googleAuth.organizationId, input.organizationId))
        .limit(1)
    : input.db.select().from(googleAuth).limit(1)
  const row = await query.then((rows) => rows[0] ?? null)
  if (!row) return null

  return decrypt(
    row.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
}

export async function getCompassGmailAccessToken(input: {
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string | null
  readonly scopes: readonly string[]
}): Promise<
  | { readonly success: true; readonly accessToken: string; readonly sender: string }
  | { readonly success: false; readonly error: string }
> {
  const keyJson = await getGoogleServiceAccountKey(input)
  if (!keyJson) {
    return {
      success: false,
      error: "Google Workspace service account is not connected.",
    }
  }

  const from =
    envString(input.env, "COMPASS_EMAIL_FROM") ?? DEFAULT_COMPASS_EMAIL_FROM
  const sender =
    envString(input.env, "COMPASS_GMAIL_SENDER") ??
    extractEmailAddress(from) ??
    DEFAULT_COMPASS_GMAIL_USER
  const serviceAccountKey = parseServiceAccountKey(keyJson)
  const jwt = await createServiceAccountJWT(
    serviceAccountKey,
    sender,
    input.scopes
  )
  const token = await exchangeJWTForAccessToken(jwt)

  return {
    success: true,
    accessToken: token.access_token,
    sender,
  }
}

async function sendGmail(input: CompassEmailInput): Promise<CompassEmailDeliveryResult> {
  const access = await getCompassGmailAccessToken({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    scopes: [COMPASS_GMAIL_SEND_SCOPE],
  })
  if (!access.success) {
    return {
      status: "pending_provider",
      provider: "gmail",
      providerMessageId: null,
      error: access.error,
    }
  }

  const from =
    envString(input.env, "COMPASS_EMAIL_FROM") ?? DEFAULT_COMPASS_EMAIL_FROM
  const raw = base64urlString(
    buildMimeMessage({
      from,
      to: input.to,
      cc: input.cc ?? [],
      replyTo: input.replyTo ?? null,
      headers: input.headers ?? [],
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
    })
  )

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  )
  const responseText = await response.text()
  let id: string | null = null
  try {
    id = providerMessageId(JSON.parse(responseText))
  } catch {
    id = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    provider: "gmail",
    providerMessageId: id,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

async function sendResend(
  input: CompassEmailInput
): Promise<CompassEmailDeliveryResult> {
  const apiKey = envString(input.env, "RESEND_API_KEY")
  if (!apiKey) {
    return {
      status: "pending_provider",
      provider: "resend",
      providerMessageId: null,
      error: "RESEND_API_KEY is not configured.",
    }
  }

  const requestBody: Record<string, unknown> = {
    from:
      envString(input.env, "COMPASS_EMAIL_FROM") ?? DEFAULT_COMPASS_EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
  }
  if (input.html) requestBody.html = input.html
  if (input.cc && input.cc.length > 0) requestBody.cc = input.cc
  if (input.replyTo) requestBody.reply_to = input.replyTo
  if (input.headers && input.headers.length > 0) {
    const headers: Record<string, string> = {}
    for (const header of input.headers) {
      const name = safeHeaderName(header.name)
      if (name) headers[name] = header.value
    }
    requestBody.headers = headers
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })
  const responseText = await response.text()
  let id: string | null = null
  try {
    id = providerMessageId(JSON.parse(responseText))
  } catch {
    id = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    provider: "resend",
    providerMessageId: id,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

export async function sendCompassEmail(
  input: CompassEmailInput
): Promise<CompassEmailDeliveryResult> {
  const preferredProvider =
    envString(input.env, "COMPASS_EMAIL_PROVIDER") ?? "gmail"

  if (preferredProvider === "resend") {
    return sendResend(input)
  }

  const gmailDelivery = await sendGmail(input)
  if (gmailDelivery.status === "sent") return gmailDelivery

  const resendDelivery = await sendResend(input)
  if (resendDelivery.status === "sent") return resendDelivery
  if (gmailDelivery.status !== "pending_provider") return gmailDelivery

  return {
    status: "pending_provider",
    provider: "gmail",
    providerMessageId: null,
    error: `${gmailDelivery.error ?? "Gmail unavailable"} ${
      resendDelivery.error ?? "Resend unavailable"
    }`.trim(),
  }
}
