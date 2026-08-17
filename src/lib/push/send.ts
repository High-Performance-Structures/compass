import { getDb } from "@/db"
import { pushTokens } from "@/db/schema"
import {
  getApnsAuthorizationToken,
  getFirebaseAccessToken,
  parseFirebaseCredentials,
  sendApnsMessage,
  sendFcmMessage,
  type ApnsCredentials,
  type ProviderResult,
  type PushMessage,
} from "@/lib/push/providers"
import { eq } from "drizzle-orm"

const DEFAULT_APNS_BUNDLE_ID = "com.hpscolorado.compass"

type PushPayload = PushMessage &
  Readonly<{
    userId: string
  }>

type PushDeliveryResult = Readonly<{
  sent: number
  failed: number
}>

type StoredPushToken = Readonly<{
  id: string
  token: string
  platform: string
}>

function readStringBinding(
  env: CloudflareEnv,
  bindingName: string,
): string | undefined {
  const value: unknown = Reflect.get(env, bindingName)
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function readApnsCredentials(
  env: CloudflareEnv,
): ApnsCredentials | undefined {
  const keyId = readStringBinding(env, "APNS_KEY_ID")
  const teamId = readStringBinding(env, "APNS_TEAM_ID")
  const privateKey = readStringBinding(env, "APNS_PRIVATE_KEY")
  if (!keyId || !teamId || !privateKey) {
    return undefined
  }

  return {
    keyId,
    teamId,
    privateKey,
    bundleId:
      readStringBinding(env, "APNS_BUNDLE_ID") ??
      DEFAULT_APNS_BUNDLE_ID,
    environment:
      readStringBinding(env, "APNS_ENVIRONMENT") === "development"
        ? "development"
        : "production",
  }
}

function logDeliveryFailure(
  provider: "apns" | "fcm",
  reason: string,
  providerStatus: number | null = null,
): void {
  console.error(
    JSON.stringify({
      event: "push_delivery_failed",
      provider,
      reason,
      ...(providerStatus === null ? {} : { providerStatus }),
    }),
  )
}

async function applyProviderResult(
  d1: D1Database,
  storedToken: StoredPushToken,
  provider: "apns" | "fcm",
  result: ProviderResult,
): Promise<boolean> {
  if (result.status === "sent") {
    return true
  }
  if (result.status === "invalid-token") {
    const db = getDb(d1)
    await db.delete(pushTokens).where(eq(pushTokens.id, storedToken.id))
    return false
  }

  logDeliveryFailure(provider, result.reason, result.providerStatus)
  return false
}

async function sendAndroidNotifications(
  env: CloudflareEnv,
  tokens: readonly StoredPushToken[],
  message: PushMessage,
): Promise<readonly boolean[]> {
  if (tokens.length === 0) {
    return []
  }

  const serializedCredentials = readStringBinding(
    env,
    "FIREBASE_SERVICE_ACCOUNT_JSON",
  )
  if (!serializedCredentials) {
    logDeliveryFailure("fcm", "Firebase credentials are not configured")
    return tokens.map(() => false)
  }

  const parsedCredentials = parseFirebaseCredentials(serializedCredentials)
  if (!parsedCredentials.success) {
    logDeliveryFailure("fcm", parsedCredentials.reason)
    return tokens.map(() => false)
  }

  const accessToken = await getFirebaseAccessToken(
    parsedCredentials.credentials,
  )
  if (!accessToken.success) {
    logDeliveryFailure("fcm", accessToken.reason)
    return tokens.map(() => false)
  }

  return Promise.all(
    tokens.map(async (storedToken) => {
      const result = await sendFcmMessage(
        parsedCredentials.credentials,
        accessToken.accessToken,
        storedToken.token,
        message,
      )
      return applyProviderResult(env.DB, storedToken, "fcm", result)
    }),
  )
}

async function sendIosNotifications(
  env: CloudflareEnv,
  tokens: readonly StoredPushToken[],
  message: PushMessage,
): Promise<readonly boolean[]> {
  if (tokens.length === 0) {
    return []
  }

  const credentials = readApnsCredentials(env)
  if (!credentials) {
    logDeliveryFailure("apns", "APNs credentials are not configured")
    return tokens.map(() => false)
  }

  const authorization = await getApnsAuthorizationToken(credentials)
  if (!authorization.success) {
    logDeliveryFailure("apns", authorization.reason)
    return tokens.map(() => false)
  }

  return Promise.all(
    tokens.map(async (storedToken) => {
      const result = await sendApnsMessage(
        credentials,
        authorization.authorizationToken,
        storedToken.token,
        message,
      )
      return applyProviderResult(env.DB, storedToken, "apns", result)
    }),
  )
}

export async function sendPushNotification(
  env: CloudflareEnv,
  payload: PushPayload,
): Promise<PushDeliveryResult> {
  const db = getDb(env.DB)
  const tokens = await db
    .select({
      id: pushTokens.id,
      token: pushTokens.token,
      platform: pushTokens.platform,
    })
    .from(pushTokens)
    .where(eq(pushTokens.userId, payload.userId))

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 }
  }

  const message: PushMessage = {
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  }
  const androidTokens = tokens.filter(
    (storedToken) => storedToken.platform === "android",
  )
  const iosTokens = tokens.filter(
    (storedToken) => storedToken.platform === "ios",
  )
  const [androidResults, iosResults] = await Promise.all([
    sendAndroidNotifications(env, androidTokens, message),
    sendIosNotifications(env, iosTokens, message),
  ])
  const sent = [...androidResults, ...iosResults].filter(Boolean).length

  return {
    sent,
    failed: tokens.length - sent,
  }
}
