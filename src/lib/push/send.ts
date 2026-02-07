// Push notification sender via FCM HTTP v1 API.
// Works from Cloudflare Workers (no Firebase SDK needed).

import { getDb } from "@/db"
import { pushTokens } from "@/db/schema"
import { eq } from "drizzle-orm"

type PushPayload = Readonly<{
  userId: string
  title: string
  body: string
  data?: Readonly<Record<string, string>>
}>

type FcmMessage = {
  message: {
    token: string
    notification: { title: string; body: string }
    data?: Record<string, string>
    android?: { priority: string }
    apns?: {
      payload: { aps: { sound: string; badge: number } }
    }
  }
}

export async function sendPushNotification(
  d1: D1Database,
  fcmServerKey: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const db = getDb(d1)

  const tokens = await db
    .select()
    .from(pushTokens)
    .where(eq(pushTokens.userId, payload.userId))

  if (tokens.length === 0) {
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  const results = await Promise.allSettled(
    tokens.map(async (t) => {
      const message: FcmMessage = {
        message: {
          token: t.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data
            ? { ...payload.data }
            : undefined,
          android: { priority: "high" },
          apns: {
            payload: {
              aps: { sound: "default", badge: 1 },
            },
          },
        },
      }

      const response = await fetch(
        "https://fcm.googleapis.com/v1/projects/-/messages:send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${fcmServerKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        },
      )

      if (!response.ok) {
        const text = await response.text()
        console.error(
          `FCM push failed for token ${t.id}:`,
          text,
        )
        // remove invalid tokens (404 = unregistered device)
        if (response.status === 404) {
          await db
            .delete(pushTokens)
            .where(eq(pushTokens.id, t.id))
        }
        throw new Error(`FCM error: ${response.status}`)
      }
    }),
  )

  for (const result of results) {
    if (result.status === "fulfilled") sent++
    else failed++
  }

  return { sent, failed }
}
