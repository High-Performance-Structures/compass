import { eq } from "drizzle-orm"
import type { LanguageModelUsage } from "ai"
import type { getDb } from "@/db"
import { agentConfig, agentUsage } from "@/db/schema-ai-config"

interface StreamResult {
  readonly totalUsage: PromiseLike<LanguageModelUsage>
}

export async function saveStreamUsage(
  db: ReturnType<typeof getDb>,
  conversationId: string,
  userId: string,
  modelId: string,
  result: StreamResult
): Promise<void> {
  try {
    const usage = await result.totalUsage

    const promptTokens = usage.inputTokens ?? 0
    const completionTokens = usage.outputTokens ?? 0
    const totalTokens = usage.totalTokens ?? 0

    const config = await db
      .select({
        promptCost: agentConfig.promptCost,
        completionCost: agentConfig.completionCost,
      })
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    const promptRate = config
      ? parseFloat(config.promptCost)
      : 0
    const completionRate = config
      ? parseFloat(config.completionCost)
      : 0

    const estimatedCost =
      promptTokens * promptRate +
      completionTokens * completionRate

    await db.insert(agentUsage).values({
      id: crypto.randomUUID(),
      conversationId,
      userId,
      modelId,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost: estimatedCost.toFixed(8),
      createdAt: new Date().toISOString(),
    })
  } catch {
    // usage tracking must never break the chat
  }
}
