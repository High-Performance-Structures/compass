import { importPKCS8, SignJWT } from "jose"

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const GOOGLE_OAUTH_AUDIENCE = "https://oauth2.googleapis.com/token"

export type PushMessage = Readonly<{
  title: string
  body: string
  data?: Readonly<Record<string, string>>
}>

export type FirebaseCredentials = Readonly<{
  projectId: string
  clientEmail: string
  privateKey: string
}>

export type ApnsCredentials = Readonly<{
  keyId: string
  teamId: string
  privateKey: string
  bundleId: string
  environment: "development" | "production"
}>

export type ProviderResult =
  | Readonly<{ status: "sent" }>
  | Readonly<{ status: "invalid-token" }>
  | Readonly<{
      status: "failed"
      providerStatus: number | null
      reason: string
    }>

type AccessTokenResult =
  | Readonly<{ success: true; accessToken: string }>
  | Readonly<{ success: false; reason: string }>

type AuthorizationTokenResult =
  | Readonly<{ success: true; authorizationToken: string }>
  | Readonly<{ success: false; reason: string }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUnregisteredFcmError(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false
  }
  const details = value.error.details
  if (!Array.isArray(details)) {
    return false
  }
  return details.some(
    (detail) =>
      isRecord(detail) && detail.errorCode === "UNREGISTERED",
  )
}

function normalizePem(value: string): string {
  return value.replaceAll("\\n", "\n").trim()
}

export function parseFirebaseCredentials(
  serializedCredentials: string,
):
  | Readonly<{ success: true; credentials: FirebaseCredentials }>
  | Readonly<{ success: false; reason: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(serializedCredentials)
  } catch {
    return {
      success: false,
      reason: "Firebase service-account credentials are not valid JSON",
    }
  }

  if (!isRecord(parsed)) {
    return {
      success: false,
      reason: "Firebase service-account credentials must be an object",
    }
  }

  const projectId = parsed.project_id
  const clientEmail = parsed.client_email
  const privateKey = parsed.private_key
  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string"
  ) {
    return {
      success: false,
      reason: "Firebase service-account credentials are missing required fields",
    }
  }

  return {
    success: true,
    credentials: {
      projectId,
      clientEmail,
      privateKey: normalizePem(privateKey),
    },
  }
}

export async function getFirebaseAccessToken(
  credentials: FirebaseCredentials,
  fetcher: typeof fetch = fetch,
): Promise<AccessTokenResult> {
  let signingKey: CryptoKey
  try {
    signingKey = await importPKCS8(credentials.privateKey, "RS256")
  } catch {
    return {
      success: false,
      reason: "Firebase service-account private key is invalid",
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(credentials.clientEmail)
    .setAudience(GOOGLE_OAUTH_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(signingKey)

  let response: Response
  try {
    response = await fetcher(GOOGLE_OAUTH_AUDIENCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    })
  } catch {
    return {
      success: false,
      reason: "Firebase OAuth token request could not reach Google",
    }
  }

  let responseBody: unknown = null
  try {
    responseBody = await response.json()
  } catch {
    // The status code below remains enough to diagnose a malformed response.
  }

  if (
    !response.ok ||
    !isRecord(responseBody) ||
    typeof responseBody.access_token !== "string"
  ) {
    return {
      success: false,
      reason: `Firebase OAuth token request failed (${response.status})`,
    }
  }

  return { success: true, accessToken: responseBody.access_token }
}

export async function sendFcmMessage(
  credentials: FirebaseCredentials,
  accessToken: string,
  deviceToken: string,
  message: PushMessage,
  fetcher: typeof fetch = fetch,
): Promise<ProviderResult> {
  let response: Response
  try {
    response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: {
              title: message.title,
              body: message.body,
            },
            ...(message.data ? { data: message.data } : {}),
            android: { priority: "HIGH" },
          },
        }),
      },
    )
  } catch {
    return {
      status: "failed",
      providerStatus: null,
      reason: "FCM could not be reached",
    }
  }

  if (response.ok) {
    return { status: "sent" }
  }
  let responseBody: unknown = null
  try {
    responseBody = await response.json()
  } catch {
    // FCM errors without a JSON body are treated as retryable failures.
  }
  if (response.status === 404 && isUnregisteredFcmError(responseBody)) {
    return { status: "invalid-token" }
  }
  return {
    status: "failed",
    providerStatus: response.status,
    reason: "FCM rejected the notification",
  }
}

export async function getApnsAuthorizationToken(
  credentials: ApnsCredentials,
): Promise<AuthorizationTokenResult> {
  let signingKey: CryptoKey
  try {
    signingKey = await importPKCS8(
      normalizePem(credentials.privateKey),
      "ES256",
    )
  } catch {
    return {
      success: false,
      reason: "APNs private key is invalid",
    }
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  let authorizationToken: string
  try {
    authorizationToken = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: credentials.keyId })
      .setIssuer(credentials.teamId)
      .setIssuedAt(issuedAt)
      .sign(signingKey)
  } catch {
    return {
      success: false,
      reason: "APNs provider token could not be signed",
    }
  }

  return {
    success: true,
    authorizationToken,
  }
}

export async function sendApnsMessage(
  credentials: ApnsCredentials,
  authorizationToken: string,
  deviceToken: string,
  message: PushMessage,
  fetcher: typeof fetch = fetch,
): Promise<ProviderResult> {
  const hostname =
    credentials.environment === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com"
  let response: Response
  try {
    response = await fetcher(
      `https://${hostname}/3/device/${encodeURIComponent(deviceToken)}`,
      {
        method: "POST",
        headers: {
          Authorization: `bearer ${authorizationToken}`,
          "Content-Type": "application/json",
          "apns-topic": credentials.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        body: JSON.stringify({
          ...(message.data ?? {}),
          aps: {
            alert: { title: message.title, body: message.body },
            sound: "default",
            badge: 1,
          },
        }),
      },
    )
  } catch {
    return {
      status: "failed",
      providerStatus: null,
      reason: "APNs could not be reached",
    }
  }

  if (response.ok) {
    return { status: "sent" }
  }
  if (response.status === 410) {
    return { status: "invalid-token" }
  }
  return {
    status: "failed",
    providerStatus: response.status,
    reason: "APNs rejected the notification",
  }
}
