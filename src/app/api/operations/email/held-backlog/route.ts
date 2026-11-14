import { postHeldEmailBacklog } from "@/lib/email/held-email-backlog"
import { signedMaintenanceRoute } from "@/lib/server/signed-maintenance-route"

/**
 * One-time maintenance, signed like every operations route (the signature
 * covers the query string): posts held job emails whose job is now known to
 * that job's Messages, quietly. Query: `limit` (default 25, at most 50),
 * `after` (the previous page's `nextAfter`), optional `organizationId`.
 * Repeat with `after` until `nextAfter` is null and `rateLimited` is false.
 * When `rateLimited` is true, Gmail refused a request: wait a few minutes,
 * then repeat with `after` = `nextAfter` (omit `after` when it is null).
 */
export async function POST(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const limit = Number(params.get("limit"))
  return signedMaintenanceRoute(request, "Held email backlog failed", (db, env) =>
    postHeldEmailBacklog({
      db,
      env,
      organizationId: params.get("organizationId"),
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
      after: params.get("after"),
    })
  )
}
