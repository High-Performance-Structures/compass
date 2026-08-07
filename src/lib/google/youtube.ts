import "server-only"

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3"
const YOUTUBE_UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3"

export const YOUTUBE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
] as const

export const YOUTUBE_CHANNEL_KEYS = ["orc", "hps", "nutech"] as const
export type YoutubeChannelKey = (typeof YOUTUBE_CHANNEL_KEYS)[number]
export type YoutubePrivacy = "private" | "unlisted" | "public"

export type YoutubeOAuthConfig = {
  readonly clientId: string
  readonly clientSecret: string
  readonly tokenEncryptionKey: string
  readonly redirectUri: string
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function environmentValue(env: object, key: string): string | null {
  const value = Object.getOwnPropertyDescriptor(env, key)?.value
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  const processValue = process.env[key]
  return typeof processValue === "string" && processValue.trim().length > 0
    ? processValue.trim()
    : null
}

export function youtubeChannelKey(value: string | null): YoutubeChannelKey | null {
  if (value === "orc" || value === "hps" || value === "nutech") return value
  return null
}

export function youtubeChannelLabel(key: YoutubeChannelKey): string {
  if (key === "hps") return "HPS"
  if (key === "nutech") return "Nu-Tech"
  return "ORC"
}

export function getYoutubeOAuthConfig(
  env: object,
  requestUrl: string
): YoutubeOAuthConfig {
  const clientId = environmentValue(env, "GOOGLE_OAUTH_CLIENT_ID")
  const clientSecret = environmentValue(env, "GOOGLE_OAUTH_CLIENT_SECRET")
  const tokenEncryptionKey = environmentValue(
    env,
    "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY"
  )
  if (!clientId || !clientSecret || !tokenEncryptionKey) {
    throw new Error("Google OAuth is not configured for YouTube.")
  }
  const requestOrigin = new URL(requestUrl)
  const redirectOrigin =
    requestOrigin.hostname === "localhost" || requestOrigin.hostname === "127.0.0.1"
      ? requestOrigin.origin
      : "https://compass.openrangeconstruction.ltd"
  return {
    clientId,
    clientSecret,
    tokenEncryptionKey,
    redirectUri: new URL("/api/google/youtube/callback", redirectOrigin).toString(),
  }
}

export function hasRequiredYoutubeScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes)
  return YOUTUBE_OAUTH_SCOPES.every((scope) => granted.has(scope))
}

export function youtubeTokenSalt(
  organizationId: string,
  channelKey: YoutubeChannelKey
): string {
  return `compass-youtube:${organizationId}:${channelKey}`
}

export function buildYoutubeAuthorizationUrl(input: {
  readonly config: YoutubeOAuthConfig
  readonly state: string
  readonly loginHint: string
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_URL)
  url.searchParams.set("client_id", input.config.clientId)
  url.searchParams.set("redirect_uri", input.config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("scope", YOUTUBE_OAUTH_SCOPES.join(" "))
  url.searchParams.set("state", input.state)
  url.searchParams.set("login_hint", input.loginHint)
  return url.toString()
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function exchangeYoutubeAuthorizationCode(input: {
  readonly config: YoutubeOAuthConfig
  readonly code: string
}): Promise<{
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly scopes: readonly string[]
}> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.config.redirectUri,
    }),
  })
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`YouTube authorization failed (${response.status}).`)
  }
  const accessToken = stringValue(payload, "access_token")
  if (!accessToken) throw new Error("Google did not return an access token.")
  const scope = stringValue(payload, "scope")
  return {
    accessToken,
    refreshToken: stringValue(payload, "refresh_token"),
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : YOUTUBE_OAUTH_SCOPES,
  }
}

export async function refreshYoutubeAccessToken(input: {
  readonly config: YoutubeOAuthConfig
  readonly refreshToken: string
}): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`YouTube token refresh failed (${response.status}).`)
  }
  const accessToken = stringValue(payload, "access_token")
  if (!accessToken) throw new Error("Google did not return an access token.")
  return accessToken
}

export async function getAuthorizedYoutubeChannel(
  accessToken: string
): Promise<{ readonly id: string; readonly title: string }> {
  const url = new URL(`${YOUTUBE_API}/channels`)
  url.searchParams.set("part", "id,snippet")
  url.searchParams.set("mine", "true")
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = await responsePayload(response)
  if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error(`YouTube channel lookup failed (${response.status}).`)
  }
  const item = payload.items.find(isRecord)
  if (!item) throw new Error("This Google account does not manage a YouTube channel.")
  const snippet = item.snippet
  const id = stringValue(item, "id")
  const title = isRecord(snippet) ? stringValue(snippet, "title") : null
  if (!id || !title) throw new Error("YouTube returned incomplete channel details.")
  return { id, title }
}

export async function uploadVideoToYoutube(input: {
  readonly accessToken: string
  readonly title: string
  readonly description: string | null
  readonly privacy: YoutubePrivacy
  readonly mimeType: string
  readonly fileSize: number
  readonly body: ReadableStream<Uint8Array>
  readonly onSessionCreated: (sessionUrl: string) => Promise<void>
}): Promise<{ readonly videoId: string; readonly url: string }> {
  const initiateUrl = new URL(`${YOUTUBE_UPLOAD_API}/videos`)
  initiateUrl.searchParams.set("uploadType", "resumable")
  initiateUrl.searchParams.set("part", "snippet,status")
  const initiate = await fetch(initiateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.fileSize),
    },
    body: JSON.stringify({
      snippet: {
        title: input.title,
        description: input.description ?? "",
        categoryId: "22",
      },
      status: {
        privacyStatus: input.privacy,
        selfDeclaredMadeForKids: false,
      },
    }),
  })
  if (!initiate.ok) {
    throw new Error(`YouTube upload initialization failed (${initiate.status}).`)
  }
  const sessionUrl = initiate.headers.get("Location")
  if (!sessionUrl) throw new Error("YouTube did not return an upload session.")
  await input.onSessionCreated(sessionUrl)

  const upload = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType,
      "Content-Length": String(input.fileSize),
    },
    body: input.body,
  })
  const payload = await responsePayload(upload)
  if (!upload.ok || !isRecord(payload)) {
    throw new Error(`YouTube video upload failed (${upload.status}).`)
  }
  const videoId = stringValue(payload, "id")
  if (!videoId) throw new Error("YouTube did not return a video ID.")
  return { videoId, url: `https://youtu.be/${videoId}` }
}
