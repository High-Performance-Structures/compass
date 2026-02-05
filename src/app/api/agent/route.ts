/**
 * Agent API Route - Proxy to ElizaOS Server
 *
 * POST /api/agent - Send message to the Compass agent
 * GET /api/agent - Get conversation history
 *
 * This route proxies requests to the ElizaOS sidecar server,
 * handling auth on the Next.js side and forwarding messages
 * to the agent's sessions API.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"

const ELIZAOS_URL =
  process.env.ELIZAOS_API_URL ?? "http://localhost:3001"

interface RequestBody {
  message: string
  conversationId?: string
  context?: {
    view?: string
    projectId?: string
  }
}

interface ElizaSessionResponse {
  id: string
  agentId?: string
  userId?: string
}

interface ElizaMessageResponse {
  id: string
  content: string
  authorId?: string
  createdAt?: string
  metadata?: Record<string, unknown>
  sessionStatus?: Record<string, unknown>
}

async function getOrCreateSession(
  userId: string,
  conversationId?: string
): Promise<string> {
  if (conversationId) return conversationId

  const response = await fetch(
    `${ELIZAOS_URL}/api/messaging/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }
  )

  if (!response.ok) {
    throw new Error(
      `Failed to create session: ${response.status} ${response.statusText}`
    )
  }

  const data: ElizaSessionResponse = await response.json()
  return data.id
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body: RequestBody = await request.json()

    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      )
    }

    const sessionId = await getOrCreateSession(
      user.id,
      body.conversationId
    )

    // Send message to ElizaOS sessions API
    const response = await fetch(
      `${ELIZAOS_URL}/api/messaging/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: body.message,
          metadata: {
            source: body.context?.view ?? "dashboard",
            projectId: body.context?.projectId,
            userId: user.id,
            userRole: user.role,
            userName: user.displayName ?? user.email,
          },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("ElizaOS error:", errorText)
      return NextResponse.json(
        { error: "Agent unavailable" },
        { status: 502 }
      )
    }

    const data: ElizaMessageResponse = await response.json()

    // Extract action data from metadata if present
    const actionData = data.metadata?.action as
      | { type: string; payload?: Record<string, unknown> }
      | undefined
    const actions = actionData ? [actionData] : undefined

    return NextResponse.json({
      id: data.id ?? crypto.randomUUID(),
      text: data.content ?? "",
      actions,
      ui: data.metadata?.ui,
      conversationId: sessionId,
    })
  } catch (error) {
    console.error("Agent API error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("conversationId")

    if (!sessionId) {
      // No session listing support via proxy yet
      return NextResponse.json({ conversations: [] })
    }

    // Get messages from ElizaOS session
    const response = await fetch(
      `${ELIZAOS_URL}/api/messaging/sessions/${sessionId}/messages?limit=100`
    )

    if (!response.ok) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      )
    }

    const messages = await response.json()

    return NextResponse.json({
      conversation: { id: sessionId },
      messages,
    })
  } catch (error) {
    console.error("Agent API error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 }
    )
  }
}
