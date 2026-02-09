import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import {
  agentConfig,
  userModelPreference,
} from "@/db/schema-ai-config"

export const DEFAULT_MODEL_ID = "qwen/qwen3-coder-next"

export async function getActiveModelId(
  db: ReturnType<typeof getDb>
): Promise<string> {
  const config = await db
    .select({ modelId: agentConfig.modelId })
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()

  return config?.modelId ?? DEFAULT_MODEL_ID
}

export function createModelFromId(
  apiKey: string,
  modelId: string
) {
  const openrouter = createOpenRouter({ apiKey })
  return openrouter(modelId, {
    provider: { allow_fallbacks: false },
  })
}

export async function resolveModelForUser(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<string> {
  const config = await db
    .select()
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()

  if (!config) return DEFAULT_MODEL_ID

  const globalModelId = config.modelId
  const ceiling = config.maxCostPerMillion
    ? parseFloat(config.maxCostPerMillion)
    : null

  const pref = await db
    .select()
    .from(userModelPreference)
    .where(eq(userModelPreference.userId, userId))
    .get()

  if (!pref) return globalModelId

  if (ceiling !== null) {
    const outputPerMillion =
      parseFloat(pref.completionCost) * 1_000_000
    if (outputPerMillion > ceiling) return globalModelId
  }

  return pref.modelId
}

export async function getAgentModel() {
  const { env } = { env: { DB: null } }
  const apiKey = (env as unknown as Record<string, string>)
    .OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not configured"
    )
  }

  const db = getDb(db)
  const modelId = await getActiveModelId(db)

  return createModelFromId(apiKey, modelId)
}
