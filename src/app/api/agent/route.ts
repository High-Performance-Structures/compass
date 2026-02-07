import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  RetryError,
  type UIMessage,
} from "ai"
import { APICallError } from "@ai-sdk/provider"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import {
  resolveModelForUser,
  createModelFromId,
  DEFAULT_MODEL_ID,
} from "@/lib/agent/provider"
import { agentTools } from "@/lib/agent/tools"
import { githubTools } from "@/lib/agent/github-tools"
import { buildSystemPrompt } from "@/lib/agent/system-prompt"
import { loadMemoriesForPrompt } from "@/lib/agent/memory"
import { getRegistry } from "@/lib/agent/plugins/registry"
import { saveStreamUsage } from "@/lib/agent/usage"
import { getCurrentUser } from "@/lib/auth"
import { getDb } from "@/db"

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { env, ctx } = await getCloudflareContext()
  const db = getDb(env.DB)
  const envRecord = env as unknown as Record<string, string>

  const apiKey = envRecord.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "OPENROUTER_API_KEY not configured",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const { getCustomDashboards } = await import(
    "@/app/actions/dashboards"
  )

  const [memories, registry, dashboardResult] =
    await Promise.all([
      loadMemoriesForPrompt(db, user.id),
      getRegistry(db, envRecord),
      getCustomDashboards(),
    ])

  const pluginSections = registry.getPromptSections()
  const pluginTools = registry.getTools()

  const body = (await req.json()) as {
    messages: UIMessage[]
  }

  const currentPage =
    req.headers.get("x-current-page") ?? undefined
  const timezone =
    req.headers.get("x-timezone") ?? undefined
  const conversationId =
    req.headers.get("x-conversation-id") ||
    crypto.randomUUID()

  let modelId = await resolveModelForUser(db, user.id)
  if (!modelId || !modelId.includes("/")) {
    console.error(
      `Invalid model ID resolved: "${modelId}",` +
        ` falling back to default`
    )
    modelId = DEFAULT_MODEL_ID
  }

  const model = createModelFromId(apiKey, modelId)

  const result = streamText({
    model,
    system: buildSystemPrompt({
      userName: user.displayName ?? user.email,
      userRole: user.role,
      currentPage,
      timezone,
      memories,
      pluginSections,
      dashboards: dashboardResult.success
        ? dashboardResult.data
        : [],
      mode: "full",
    }),
    messages: await convertToModelMessages(
      body.messages
    ),
    tools: {
      ...agentTools,
      ...githubTools,
      ...pluginTools,
    },
    toolChoice: "auto",
    stopWhen: stepCountIs(10),
    onError({ error }) {
      const apiErr = unwrapAPICallError(error)
      if (apiErr) {
        console.error(
          `Agent API error [model=${modelId}]`,
          `status=${apiErr.statusCode}`,
          `body=${apiErr.responseBody}`
        )
      } else {
        const msg =
          error instanceof Error
            ? error.message
            : String(error)
        console.error(
          `Agent error [model=${modelId}]:`,
          msg
        )
      }
    },
  })

  ctx.waitUntil(
    saveStreamUsage(
      db,
      conversationId,
      user.id,
      modelId,
      result
    )
  )

  return result.toUIMessageStreamResponse({
    onError(error) {
      const apiErr = unwrapAPICallError(error)
      if (apiErr) {
        return (
          apiErr.responseBody ??
          `Provider error (${apiErr.statusCode})`
        )
      }
      return error instanceof Error
        ? error.message
        : "Unknown error"
    },
  })
}

function unwrapAPICallError(
  error: unknown
): APICallError | undefined {
  if (APICallError.isInstance(error)) return error
  if (RetryError.isInstance(error)) {
    const last: unknown = error.lastError
    if (APICallError.isInstance(last)) return last
  }
  return undefined
}
