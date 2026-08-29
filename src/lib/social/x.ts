import "server-only"

const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
] as const

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

async function jsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function xError(operation: string, response: Response, payload: unknown): Error {
  const detail = isRecord(payload) ? stringValue(payload.detail) ?? stringValue(payload.title) : null
  return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : "."}`)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function createXCodeVerifier(): string {
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function xCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export async function buildXAuthorizationUrl(input: {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly codeVerifier: string
}): Promise<string> {
  const url = new URL("https://x.com/i/oauth2/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("scope", X_SCOPES.join(" "))
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", await xCodeChallenge(input.codeVerifier))
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

function tokenAuthorization(clientId: string, clientSecret: string | null): string | null {
  if (!clientSecret) return null
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

async function tokenRequest(input: {
  readonly clientId: string
  readonly clientSecret: string | null
  readonly fields: Readonly<Record<string, string>>
}): Promise<{
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresIn: number
  readonly scopes: readonly string[]
}> {
  const authorization = tokenAuthorization(input.clientId, input.clientSecret)
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" })
  if (authorization) headers.set("Authorization", authorization)
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: new URLSearchParams({ client_id: input.clientId, ...input.fields }),
  })
  const payload = await jsonPayload(response)
  if (!response.ok || !isRecord(payload)) throw xError("X authorization", response, payload)
  const accessToken = stringValue(payload.access_token)
  if (!accessToken) throw new Error("X did not return an access token.")
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 7200
  const scope = stringValue(payload.scope)
  return {
    accessToken,
    refreshToken: stringValue(payload.refresh_token),
    expiresIn,
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : X_SCOPES,
  }
}

export function exchangeXAuthorizationCode(input: {
  readonly clientId: string
  readonly clientSecret: string | null
  readonly redirectUri: string
  readonly code: string
  readonly codeVerifier: string
}): ReturnType<typeof tokenRequest> {
  return tokenRequest({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fields: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
  })
}

export function refreshXAccessToken(input: {
  readonly clientId: string
  readonly clientSecret: string | null
  readonly refreshToken: string
}): ReturnType<typeof tokenRequest> {
  return tokenRequest({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fields: { grant_type: "refresh_token", refresh_token: input.refreshToken },
  })
}

export async function getXIdentity(accessToken: string): Promise<{
  readonly id: string
  readonly username: string
  readonly name: string
}> {
  const response = await fetch("https://api.x.com/2/users/me?user.fields=name,username", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = await jsonPayload(response)
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
  if (!response.ok || !data) throw xError("X account lookup", response, payload)
  const id = stringValue(data.id)
  const username = stringValue(data.username)
  const name = stringValue(data.name)
  if (!id || !username || !name) throw new Error("X returned incomplete account details.")
  return { id, username, name }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function uploadXImage(input: {
  readonly accessToken: string
  readonly bytes: Uint8Array
  readonly mimeType: string
}): Promise<string> {
  const response = await fetch("https://api.x.com/2/media/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media: bytesToBase64(input.bytes),
      media_category: "tweet_image",
      media_type: input.mimeType,
    }),
  })
  const payload = await jsonPayload(response)
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
  if (!response.ok || !data) throw xError("X media upload", response, payload)
  const id = stringValue(data.id)
  if (!id) throw new Error("X did not return a media ID.")
  return id
}

export async function publishXPost(input: {
  readonly accessToken: string
  readonly text: string
  readonly mediaIds: readonly string[]
}): Promise<{ readonly id: string; readonly url: string }> {
  const body = input.mediaIds.length > 0
    ? { text: input.text, media: { media_ids: input.mediaIds } }
    : { text: input.text }
  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const payload = await jsonPayload(response)
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
  if (!response.ok || !data) throw xError("X publishing", response, payload)
  const id = stringValue(data.id)
  if (!id) throw new Error("X did not return the Post ID.")
  return { id, url: `https://x.com/i/web/status/${id}` }
}

export function requiredXScopes(): readonly string[] {
  return X_SCOPES
}
