import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { canSearchCompassRole } from "@/lib/jarvis/search"
import { storedJarvisVisuals } from "@/lib/jarvis/visual-context"

function eventRole(payload: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const user: unknown = Reflect.get(parsed, "user")
  if (typeof user !== "object" || user === null) return null
  const role: unknown = Reflect.get(user, "role")
  return typeof role === "string" ? role : null
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    readonly params: Promise<{ readonly id: string }>
  },
): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 },
    )
  }

  const verification = await verifyJarvisRequest(request, secret, "")
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  const { id } = await params
  const db = getDb(env.DB)
  const event = await db
    .select({ payload: jarvisBridgeEvents.payload })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.id, id),
        eq(jarvisBridgeEvents.direction, "outbound"),
        eq(jarvisBridgeEvents.eventType, "agent.prompt"),
      ),
    )
    .get()

  const role = event ? eventRole(event.payload) : null
  if (!event || !role) {
    return Response.json({ error: "Agent event not found" }, { status: 404 })
  }
  if (!canSearchCompassRole(role)) {
    return Response.json(
      { error: "Visual context is unavailable for this account" },
      { status: 403 },
    )
  }

  const images = storedJarvisVisuals(event.payload)
  if (images.length === 0) {
    return Response.json({ error: "No visual context was attached" }, { status: 404 })
  }

  return Response.json(
    {
      eventId: id,
      explicitUserAttachments: true,
      images,
      count: images.length,
      readOnly: true,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}
