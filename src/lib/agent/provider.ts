import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { getCloudflareContext } from "@opennextjs/cloudflare"

const MODEL_ID = "qwen/qwen3-coder-next"

export async function getAgentModel() {
  const { env } = await getCloudflareContext()
  const apiKey = (env as unknown as Record<string, string>)
    .OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not configured"
    )
  }

  const openrouter = createOpenRouter({ apiKey })
  return openrouter(MODEL_ID, {
    provider: {
      allow_fallbacks: false,
    },
  })
}
