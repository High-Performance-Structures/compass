import { updatePresence, type PresenceStatus } from "@/app/actions/presence"

export const dynamic = "force-dynamic"

const STATUSES: readonly string[] = ["online", "idle", "dnd", "offline"]

function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === "string" && STATUSES.includes(value)
}

/**
 * The presence heartbeat and status changes. A plain request (not a server
 * action) so the 30-second heartbeat never waits in line with, or holds up,
 * the page's own server actions.
 */
export async function POST(request: Request): Promise<Response> {
  // Server actions check the origin for us; this route has to do it itself.
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!origin || !host || new URL(origin).host !== host) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 })
  }
  const body: unknown = await request.json().catch(() => null)
  if (typeof body !== "object" || body === null) return Response.json({ success: false, error: "Invalid request" }, { status: 400 })
  const status = Reflect.get(body, "status")
  const statusMessage = Reflect.get(body, "statusMessage")
  const result = await updatePresence(
    isPresenceStatus(status) ? status : undefined,
    typeof statusMessage === "string" ? statusMessage : undefined,
    Reflect.get(body, "observedActivity") === true
  )
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
