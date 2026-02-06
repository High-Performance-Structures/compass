import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai"
import { getAgentModel } from "@/lib/agent/provider"
import { agentTools } from "@/lib/agent/tools"
import { buildSystemPrompt } from "@/lib/agent/system-prompt"
import { getCurrentUser } from "@/lib/auth"

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body = await req.json() as {
    messages: UIMessage[]
  }

  const currentPage =
    req.headers.get("x-current-page") ?? undefined

  const model = await getAgentModel()

  const result = streamText({
    model,
    system: buildSystemPrompt({
      userName: user.displayName ?? user.email,
      userRole: user.role,
      currentPage,
    }),
    messages: await convertToModelMessages(body.messages),
    tools: agentTools,
    stopWhen: stepCountIs(10),
  })

  return result.toUIMessageStreamResponse()
}
