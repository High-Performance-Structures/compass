export type GoogleConfig = {
  readonly encryptionKey: string
}

export function getGoogleConfig(
  env: Record<string, string | undefined>
): GoogleConfig {
  const encryptionKey = env.GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY
  if (!encryptionKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY not configured"
    )
  }

  return { encryptionKey }
}

export type ServiceAccountKey = {
  readonly type: string
  readonly project_id: string
  readonly private_key_id: string
  readonly private_key: string
  readonly client_email: string
  readonly client_id: string
  readonly auth_uri: string
  readonly token_uri: string
  readonly auth_provider_x509_cert_url: string
  readonly client_x509_cert_url: string
  readonly universe_domain: string
}

export function parseServiceAccountKey(
  json: string
): ServiceAccountKey {
  const parsed: unknown = JSON.parse(json)
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    !("private_key" in parsed) ||
    !("client_email" in parsed)
  ) {
    throw new Error("Invalid service account key JSON")
  }
  return parsed as ServiceAccountKey
}

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
] as const

export const GOOGLE_TOKEN_URL =
  "https://oauth2.googleapis.com/token"

export const GOOGLE_DRIVE_API =
  "https://www.googleapis.com/drive/v3"

export const GOOGLE_UPLOAD_API =
  "https://www.googleapis.com/upload/drive/v3"

const GOOGLE_CRYPTO_SALT = "compass-google-service-account"

export function getGoogleCryptoSalt(): string {
  return GOOGLE_CRYPTO_SALT
}
