import "server-only"

import type { DataSource } from "agent-core"
import { POST as dashboardsPOST } from "@/app/api/compass/dashboards/route"
import { POST as githubPOST } from "@/app/api/compass/github/route"
import { POST as memoryPOST } from "@/app/api/compass/memory/route"
import { POST as queryPOST } from "@/app/api/compass/query/route"
import { POST as schedulePOST } from "@/app/api/compass/schedule/route"
import { POST as skillsPOST } from "@/app/api/compass/skills/route"
import { POST as themesPOST } from "@/app/api/compass/themes/route"

type RouteHandler = (request: Request) => Promise<Response>

/** Agent tool API paths and the route handlers that serve them. */
export const AGENT_TOOL_ROUTES: ReadonlyMap<string, RouteHandler> = new Map([
  ["/api/compass/dashboards", dashboardsPOST],
  ["/api/compass/github", githubPOST],
  ["/api/compass/memory", memoryPOST],
  ["/api/compass/query", queryPOST],
  ["/api/compass/schedule", schedulePOST],
  ["/api/compass/skills", skillsPOST],
  ["/api/compass/themes", themesPOST],
])

function errorText(value: unknown, status: number): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error
    if (typeof error === "string" && error.length > 0) return error
  }
  return `API error ${status}`
}

/**
 * Runs agent tool calls against the Compass API route handlers in the same
 * request instead of over HTTP. A network call back to Compass's own domain
 * carries no session cookie, so the auth middleware redirects it to /login,
 * and a Worker calling its own hostname is unreliable on Cloudflare. Each
 * handler still validates the agent token and the user's permissions.
 */
export function createInProcessDataSource(
  token: string,
  routes: ReadonlyMap<string, RouteHandler> = AGENT_TOOL_ROUTES,
): DataSource {
  return {
    async fetch(path: string, body?: unknown): Promise<unknown> {
      const handler = routes.get(path)
      if (!handler) {
        throw new Error(`No Compass API handler for ${path}`)
      }
      const response = await handler(
        new Request(`https://compass.internal${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body ?? {}),
        }),
      )
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(errorText(payload, response.status))
      }
      return payload
    },
  }
}
