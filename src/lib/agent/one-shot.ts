import "server-only"

import { runAgent } from "agent-core"
import { eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { agentConfig } from "@/db/schema-ai-config"
import { getProviderConfigForJwt } from "@/lib/agent/provider-config"
import {
  resolveRuntimeModelId,
  resolveRuntimeProvider,
  selectRuntimeModel,
} from "@/lib/agent/runtime-config"

const ORG_DEFAULT_PROVIDER = "org_default"

/**
 * One tool-free request to the organization's AI provider, for server-side
 * drafting (owner updates). Uses the same provider and model resolution as
 * Ask Jarvis, so OPENAI_API_KEY / OPENAI_MODEL apply, and never touches the
 * private Jarvis relay or Signet.
 */
export async function generateOrganizationText(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly systemPrompt: string
  readonly prompt: string
}): Promise<
  | { readonly success: true; readonly text: string }
  | { readonly success: false; readonly error: string }
> {
  const stored = await getProviderConfigForJwt(ORG_DEFAULT_PROVIDER)
  const provider = resolveRuntimeProvider(stored, input.env)
  if (!provider.success) {
    return { success: false, error: provider.error }
  }

  const config = await input.db
    .select({ modelId: agentConfig.modelId })
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()
  const model = resolveRuntimeModelId(
    selectRuntimeModel(config?.modelId, null),
    provider.providerType,
    input.env.OPENAI_MODEL,
  )

  let streamed = ""
  for await (const event of runAgent({
    provider: provider.provider,
    model,
    systemPrompt: input.systemPrompt,
    messages: [{ role: "user", content: input.prompt }],
    maxTurns: 1,
  })) {
    if (event.type === "error") {
      return { success: false, error: event.error }
    }
    if (event.type === "text") {
      streamed += event.content
    }
    if (event.type === "result") {
      return { success: true, text: event.result || streamed }
    }
  }
  return { success: false, error: "The AI provider returned no answer." }
}
