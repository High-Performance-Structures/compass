#!/usr/bin/env bun
/**
 * Compass Agent Server
 * Standalone server using agent-core for the agentic loop
 */

import { config } from "./config"
import { validateAuth } from "./auth"
import { createAgentStream } from "./stream"

interface ChatRequest {
  messages: Array<{
    role: "user" | "assistant"
    content: string
  }>
}

/**
 * Handle POST /agent/chat
 */
async function handleChat(request: Request): Promise<Response> {
  // Validate auth
  const authResult = await validateAuth(request)
  if ("error" in authResult) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )
  }

  // Extract JWT token from Authorization header
  const authHeader = request.headers.get("authorization")
  const authToken = authHeader?.slice(7) || "" // Remove "Bearer " prefix

  // Extract headers
  const sessionId = request.headers.get("x-session-id") || crypto.randomUUID()
  const currentPage = request.headers.get("x-current-page") || "/"
  const timezone = request.headers.get("x-timezone") || "UTC"
  const model = request.headers.get("x-model") || "sonnet"

  // Parse body
  let body: ChatRequest
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required and cannot be empty" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  // Create SSE stream
  const stream = await createAgentStream(body.messages, {
    auth: authResult,
    authToken,
    sessionId,
    currentPage,
    timezone,
    provider: authResult.provider,
    model,
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
      "Access-Control-Allow-Credentials": "true",
    },
  })
}

/**
 * Handle GET /health
 */
function handleHealth(): Response {
  return new Response(
    JSON.stringify({ status: "ok", version: "0.1.0" }),
    { headers: { "Content-Type": "application/json" } }
  )
}

/**
 * CORS preflight handler
 */
function handlePreflight(request: Request): Response {
  const origin = request.headers.get("origin") || ""
  const allowed = config.allowedOrigins.includes(origin) || config.allowedOrigins.includes("*")

  if (!allowed) {
    return new Response(null, { status: 403 })
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-session-id, x-current-page, x-timezone, x-model",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  })
}

/**
 * Main request router
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handlePreflight(request)
  }

  // Route requests
  if (url.pathname === "/health" && request.method === "GET") {
    return handleHealth()
  }

  if (url.pathname === "/agent/chat" && request.method === "POST") {
    return handleChat(request)
  }

  return new Response(
    JSON.stringify({ error: "Not found" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  )
}

/**
 * Start the server
 */
const server = Bun.serve({
  port: config.port,
  async fetch(request) {
    return handleRequest(request)
  },
})

console.log(`Agent server running on http://localhost:${server.port}`)
console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`)
