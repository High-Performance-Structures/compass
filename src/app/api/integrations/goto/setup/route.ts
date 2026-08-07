import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { gotoInboundSettings } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { gotoWebhookConfig } from "@/lib/goto/webhook-security"
import { getGotoAccessToken } from "@/lib/notifications/create-event"
import { requireOrg } from "@/lib/org-scope"
import { can } from "@/lib/permissions"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const field = value[key]
  if (typeof field === "string" && field.trim().length > 0) return field.trim()
  if (typeof field === "number" && Number.isFinite(field)) return String(field)
  return null
}

async function responseValue(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GoTo setup failed (${response.status}): ${text.slice(0, 500)}`)
  }
  if (text.trim().length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("GoTo setup returned invalid JSON")
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  if (!can(user, "channels", "moderate")) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
  }

  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const config = gotoWebhookConfig(env)
  if (!config || config.organizationId !== organizationId) {
    return NextResponse.json(
      { success: false, error: "GoTo webhook secrets are not configured for this organization" },
      { status: 503 }
    )
  }
  const db = getDb(env.DB)
  const existing = await db
    .select({
      accountKey: gotoInboundSettings.accountKey,
      channelId: gotoInboundSettings.channelId,
    })
    .from(gotoInboundSettings)
    .where(eq(gotoInboundSettings.organizationId, organizationId))
    .get()
  if (existing) {
    return NextResponse.json({
      success: true,
      configured: true,
      accountKey: existing.accountKey,
      channelId: existing.channelId,
    })
  }

  const token = await getGotoAccessToken(env)
  if (!token.success) {
    return NextResponse.json({ success: false, error: token.error }, { status: 502 })
  }
  const authHeaders = { Authorization: `Bearer ${token.accessToken}` }
  const meResponse = await fetch("https://api.getgo.com/admin/rest/v1/me", {
    headers: authHeaders,
  })
  const me = await responseValue(meResponse)
  const accountKey = stringField(me, "accountKey")
  if (!accountKey) {
    return NextResponse.json(
      { success: false, error: "GoTo account key was not available to the configured administrator" },
      { status: 502 }
    )
  }

  const callback = new URL("/api/integrations/goto/inbound", request.url)
  callback.searchParams.set("secret", config.secret)
  const channelNickname = `compass-${organizationId.replace(/[^a-z0-9]/gi, "-").slice(0, 32)}`
  const channelResponse = await fetch(
    `https://api.goto.com/notification-channel/v1/channels/${encodeURIComponent(channelNickname)}`,
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "Webhook",
        webhookChannelData: { webhook: { url: callback.toString() } },
      }),
    }
  )
  const channel = await responseValue(channelResponse)
  const channelId = stringField(channel, "channelId")
  if (!channelId) throw new Error("GoTo did not return a notification channel ID")

  const subscriptionResponse = await fetch("https://api.goto.com/messaging/v2/subscriptions", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      accountKey,
      ownerEntity: accountKey,
      ownerEntityType: "ORGANIZATION",
      channelId,
      eventTypes: ["INBOUND_MESSAGE"],
    }),
  })
  const subscription = await responseValue(subscriptionResponse)
  const subscriptionId = stringField(subscription, "id")
  const now = new Date().toISOString()
  await db.insert(gotoInboundSettings).values({
    id: crypto.randomUUID(),
    organizationId,
    accountKey,
    channelId,
    channelNickname,
    subscriptionId,
    configuredBy: user.id,
    createdAt: now,
    updatedAt: now,
  }).run()

  return NextResponse.json({
    success: true,
    configured: true,
    accountKey,
    channelId,
  })
}
