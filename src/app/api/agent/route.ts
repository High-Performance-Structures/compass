import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getAgentModel } from "@/lib/agent/provider"
import { agentTools } from "@/lib/agent/tools"
import { githubTools } from "@/lib/agent/github-tools"
import { buildSystemPrompt } from "@/lib/agent/system-prompt"
import { loadMemoriesForPrompt } from "@/lib/agent/memory"
import { getRegistry } from "@/lib/agent/plugins/registry"
import { getCurrentUser } from "@/lib/auth"
import { getDb } from "@/db"

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const envRecord = env as unknown as Record<string, string>

  const [memories, registry] = await Promise.all([
    loadMemoriesForPrompt(db, user.id),
    getRegistry(db, envRecord),
  ])

  const pluginSections = registry.getPromptSections()

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
      memories,
      pluginSections,
      mode: "full",
    }),
    messages: await convertToModelMessages(body.messages),
    tools: { ...agentTools, ...githubTools },
    stopWhen: stepCountIs(10),
  })

  return result.toUIMessageStreamResponse()
}
