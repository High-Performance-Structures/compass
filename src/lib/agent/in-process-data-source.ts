import "server-only"

import type { DataSource } from "agent-core"

/** A Compass API route handler the agent can call in-process. */
export type AgentRouteHandler = (request: Request) => Promise<Response>

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
 * handler still validates the agent token and the user's permissions. The
 * route map (src/app/api/compass/agent-tool-routes.ts) is passed in so this
 * module does not depend on the app layer.
 */
export async function callAgentRoute(
  token: string,
  path: string,
  body: unknown,
  routes: ReadonlyMap<string, AgentRouteHandler>,
): Promise<unknown> {
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
}

/**
 * Answers a tool call without running its handler, or returns undefined to
 * let it run. Used to hold consequential actions for user confirmation.
 */
export type ToolCallInterceptor = (
  path: string,
  body: unknown,
) => Promise<unknown>

export function createInProcessDataSource(
  token: string,
  options: {
    readonly routes: ReadonlyMap<string, AgentRouteHandler>
    readonly intercept?: ToolCallInterceptor
  },
): DataSource {
  const routes = options.routes
  return {
    async fetch(path: string, body?: unknown): Promise<unknown> {
      const intercepted = options.intercept
        ? await options.intercept(path, body)
        : undefined
      if (intercepted !== undefined) return intercepted
      return callAgentRoute(token, path, body, routes)
    },
  }
}
