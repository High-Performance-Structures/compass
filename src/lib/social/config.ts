import "server-only"

type SocialConfig = {
  readonly tokenEncryptionKey: string
  readonly publicBaseUrl: string
  readonly metaAppId: string | null
  readonly metaAppSecret: string | null
  readonly metaApiVersion: string
  readonly xClientId: string | null
  readonly xClientSecret: string | null
  readonly aiModel: string
}

export function environmentString(env: object, key: string): string | null {
  const value: unknown = Reflect.get(env, key)
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  const processValue = process.env[key]
  return typeof processValue === "string" && processValue.trim().length > 0
    ? processValue.trim()
    : null
}

export function getSocialConfig(env: object, requestUrl?: string): SocialConfig {
  const tokenEncryptionKey = environmentString(env, "SOCIAL_TOKEN_ENCRYPTION_KEY")
  if (!tokenEncryptionKey) {
    throw new Error("Social publishing token encryption is not configured.")
  }
  const requestOrigin = requestUrl ? new URL(requestUrl).origin : null
  const publicBaseUrl =
    environmentString(env, "SOCIAL_PUBLIC_BASE_URL") ??
    requestOrigin ??
    "https://compass.openrangeconstruction.ltd"

  return {
    tokenEncryptionKey,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    metaAppId: environmentString(env, "META_APP_ID"),
    metaAppSecret: environmentString(env, "META_APP_SECRET"),
    metaApiVersion: environmentString(env, "META_GRAPH_API_VERSION") ?? "v25.0",
    xClientId: environmentString(env, "X_CLIENT_ID"),
    xClientSecret: environmentString(env, "X_CLIENT_SECRET"),
    aiModel: environmentString(env, "SOCIAL_AI_MODEL") ?? "google/gemini-2.5-flash",
  }
}

export function socialTokenSalt(input: {
  readonly organizationId: string
  readonly platform: string
  readonly department: string
}): string {
  return `compass-social:${input.organizationId}:${input.department}:${input.platform}`
}
