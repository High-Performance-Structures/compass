import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { saveMemory, searchMemories } from "@/lib/agent/memory"
import {
  getConversationTranscript,
  listRecentConversations,
} from "@/lib/agent/conversation-recall"

type MemoryAction = "save" | "search" | "recentConversations" | "conversation"

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()

  const auth = await validateAgentAuth(req, env)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const db = getDb(env.DB)

  let body: { action: MemoryAction; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    switch (body.action) {
      case "save": {
        const content = body.content as string
        const memoryType = body.memoryType as
          | "preference"
          | "workflow"
          | "fact"
          | "decision"
        const tags = (body.tags as string) ?? undefined
        const importance = (body.importance as number) ?? undefined

        if (!content || !memoryType) {
          return new Response(
            JSON.stringify({
              error: "content and memoryType required",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const id = await saveMemory(
          db,
          auth.userId,
          content,
          memoryType,
          tags,
          importance,
        )

        return new Response(
          JSON.stringify({
            success: true,
            id,
            content,
            memoryType,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "search": {
        const query = body.query as string
        const limit = (body.limit as number) ?? 5

        if (!query) {
          return new Response(
            JSON.stringify({ error: "query required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const results = await searchMemories(
          db,
          auth.userId,
          query,
          limit,
        )

        return new Response(
          JSON.stringify({
            success: true,
            results,
            count: results.length,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      // Earlier Ask Jarvis chats, only when the user asks to recall one.
      case "recentConversations": {
        const limit = typeof body.limit === "number" ? body.limit : 10
        const conversations = await listRecentConversations(db, auth.userId, limit)
        return Response.json({ success: true, conversations, count: conversations.length })
      }

      case "conversation": {
        const conversationId =
          typeof body.conversationId === "string" ? body.conversationId : ""
        const transcript = conversationId
          ? await getConversationTranscript(db, auth.userId, conversationId)
          : null
        if (!transcript) {
          return Response.json({ error: "Conversation not found" }, { status: 404 })
        }
        return Response.json({ success: true, conversation: transcript })
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("Memory endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
