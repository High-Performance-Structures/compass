import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { resolveAgentUser } from "@/lib/agent/agent-user"
import {
  listVisibleChannels,
  searchVisibleMessages,
} from "@/lib/conversations/agent-messages"

const DAY_MS = 24 * 60 * 60 * 1000

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * Read-only conversation lookups for the agent: the channels a user can see
 * (with unread counts) and recent or matching messages in them. Writes stay
 * in the conversations UI.
 */
export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = getDb(env.DB)
  const user = await resolveAgentUser(db, auth)
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const body: Record<string, unknown> =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  const action = stringField(body, "action")

  if (user.organizationId === null) {
    return Response.json({ error: "No organization" }, { status: 403 })
  }
  const viewer = { id: user.id, role: user.role, organizationId: user.organizationId }

  try {
    switch (action) {
      case "channels": {
        const channels = await listVisibleChannels(db, viewer)
        const unreadOnly = body.unreadOnly === true
        const data = unreadOnly
          ? channels.filter((channel) => channel.unreadCount > 0)
          : channels
        return Response.json({
          data,
          count: data.length,
          totalUnread: channels.reduce((sum, channel) => sum + channel.unreadCount, 0),
        })
      }

      case "search": {
        const sinceDays = numberField(body, "sinceDays")
        const result = await searchVisibleMessages(db, viewer, {
          search: stringField(body, "search"),
          channelId: stringField(body, "channelId"),
          since:
            sinceDays !== undefined && sinceDays > 0
              ? new Date(Date.now() - sinceDays * DAY_MS).toISOString()
              : undefined,
          limit: numberField(body, "limit"),
        })
        if (!result.success) {
          return Response.json({ error: result.error }, { status: 404 })
        }
        return Response.json({ data: result.data, count: result.data.length })
      }

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Messages endpoint error:", error)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
