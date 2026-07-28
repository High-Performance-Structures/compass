export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const

export const GOOGLE_OAUTH_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_OAUTH_TOKEN_URL =
  "https://oauth2.googleapis.com/token"
export const GOOGLE_OPENID_USERINFO_URL =
  "https://openidconnect.googleapis.com/v1/userinfo"

export type GoogleCalendarOAuthConfig = {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly tokenEncryptionKey: string
}

export type GoogleCalendarOAuthConfigResult =
  | {
      readonly configured: true
      readonly config: GoogleCalendarOAuthConfig
    }
  | {
      readonly configured: false
      readonly missing: readonly string[]
    }

function environmentValue(env: object, key: string): string | null {
  const directValue = Object.getOwnPropertyDescriptor(env, key)?.value
  const value =
    typeof directValue === "string" && directValue.trim().length > 0
      ? directValue
      : process.env[key]

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

export function getGoogleCalendarOAuthConfig(
  env: object,
): GoogleCalendarOAuthConfigResult {
  const values = {
    clientId: environmentValue(env, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: environmentValue(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: environmentValue(env, "GOOGLE_OAUTH_REDIRECT_URI"),
    tokenEncryptionKey: environmentValue(
      env,
      "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
    ),
  }
  const missing = [
    values.clientId ? null : "GOOGLE_OAUTH_CLIENT_ID",
    values.clientSecret ? null : "GOOGLE_OAUTH_CLIENT_SECRET",
    values.redirectUri ? null : "GOOGLE_OAUTH_REDIRECT_URI",
    values.tokenEncryptionKey
      ? null
      : "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  ].filter((value): value is string => value !== null)

  if (
    missing.length > 0 ||
    !values.clientId ||
    !values.clientSecret ||
    !values.redirectUri ||
    !values.tokenEncryptionKey
  ) {
    return { configured: false, missing }
  }

  return {
    configured: true,
    config: {
      clientId: values.clientId,
      clientSecret: values.clientSecret,
      redirectUri: values.redirectUri,
      tokenEncryptionKey: values.tokenEncryptionKey,
    },
  }
}

export function googleCalendarTokenSalt(userId: string): string {
  return `compass-google-calendar:${userId}`
}
