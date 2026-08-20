import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OPENID_USERINFO_URL,
  type GoogleCalendarOAuthConfig,
} from "./config"

type JsonRecord = Record<string, unknown>

export type GoogleTokenGrant = {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresIn: number
  readonly scopes: readonly string[]
}

export type GoogleAccessToken = {
  readonly accessToken: string
  readonly expiresIn: number
}

export type GoogleAccountIdentity = {
  readonly subject: string
  readonly email: string
  readonly emailVerified: boolean
}

const GOOGLE_SCOPE_EQUIVALENTS: Readonly<
  Record<string, readonly string[]>
> = {
  email: [
    "email",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
}

export function hasRequiredGoogleCalendarScopes(
  scopes: readonly string[],
): boolean {
  const granted = new Set(scopes)
  return GOOGLE_CALENDAR_SCOPES.every((scope) => {
    const equivalents = GOOGLE_SCOPE_EQUIVALENTS[scope] ?? [scope]
    return equivalents.some((candidate) => granted.has(candidate))
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(
  record: JsonRecord,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function optionalString(
  record: JsonRecord,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function buildGoogleCalendarAuthorizationUrl(
  config: GoogleCalendarOAuthConfig,
  state: string,
  loginHint: string,
): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZATION_URL)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("login_hint", loginHint)
  return url.toString()
}

export async function exchangeGoogleAuthorizationCode(
  config: GoogleCalendarOAuthConfig,
  code: string,
): Promise<GoogleTokenGrant> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  })
  const payload = await responseJson(response)
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Google token exchange failed (${response.status}).`)
  }

  const accessToken = requiredString(payload, "access_token")
  const refreshToken = optionalString(payload, "refresh_token")
  const expiresIn = payload.expires_in
  const scope = optionalString(payload, "scope")
  if (
    !accessToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    throw new Error("Google returned an incomplete token grant.")
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
    scopes: scope
      ? scope.split(/\s+/).filter(Boolean)
      : [...GOOGLE_CALENDAR_SCOPES],
  }
}

export async function refreshGoogleAccessToken(
  config: GoogleCalendarOAuthConfig,
  refreshToken: string,
): Promise<GoogleAccessToken> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const payload = await responseJson(response)
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Google token refresh failed (${response.status}).`)
  }

  const accessToken = requiredString(payload, "access_token")
  const expiresIn = payload.expires_in
  if (
    !accessToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    throw new Error("Google returned an incomplete refreshed token.")
  }

  return { accessToken, expiresIn }
}

export async function getGoogleAccountIdentity(
  accessToken: string,
): Promise<GoogleAccountIdentity> {
  const response = await fetch(GOOGLE_OPENID_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const payload = await responseJson(response)
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Google account lookup failed (${response.status}).`)
  }

  const subject = requiredString(payload, "sub")
  const email = requiredString(payload, "email")
  const emailVerified = payload.email_verified
  if (!subject || !email || typeof emailVerified !== "boolean") {
    throw new Error("Google returned an incomplete account identity.")
  }

  return { subject, email, emailVerified }
}
