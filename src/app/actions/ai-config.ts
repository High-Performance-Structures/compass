"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, desc, and, gte } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import {
  agentConfig,
  agentUsage,
  userModelPreference,
} from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"

// --- types ---

interface ModelInfo {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly contextLength: number
  readonly promptCost: string
  readonly completionCost: string
}

interface ProviderGroup {
  readonly provider: string
  readonly models: ReadonlyArray<ModelInfo>
}

interface UsageMetrics {
  readonly totalRequests: number
  readonly totalTokens: number
  readonly totalCost: string
  readonly dailyBreakdown: ReadonlyArray<{
    date: string
    tokens: number
    cost: string
    requests: number
  }>
  readonly modelBreakdown: ReadonlyArray<{
    modelId: string
    tokens: number
    cost: string
    requests: number
  }>
}

// --- module-level cache for model list ---

let cachedModels: ReadonlyArray<ProviderGroup> | null =
  null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

// --- actions ---

export async function getActiveModel(): Promise<{
  success: true
  data: {
    modelId: string
    modelName: string
    provider: string
    promptCost: string
    completionCost: string
    contextLength: number
    maxCostPerMillion: string | null
    allowUserSelection: boolean
    isAdmin: boolean
  } | null
} | {
  success: false
  error: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const isAdmin = can(user, "agent", "update")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    return {
      success: true,
      data: config
        ? {
            modelId: config.modelId,
            modelName: config.modelName,
            provider: config.provider,
            promptCost: config.promptCost,
            completionCost: config.completionCost,
            contextLength: config.contextLength,
            maxCostPerMillion:
              config.maxCostPerMillion ?? null,
            allowUserSelection:
              config.allowUserSelection === 1,
            isAdmin,
          }
        : null,
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get active model",
    }
  }
}

export async function setActiveModel(
  modelId: string,
  modelName: string,
  provider: string,
  promptCost: string,
  completionCost: string,
  contextLength: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return {
        success: false,
        error: "Permission denied",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const existing = await db
      .select({ id: agentConfig.id })
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    if (existing) {
      await db
        .update(agentConfig)
        .set({
          modelId,
          modelName,
          provider,
          promptCost,
          completionCost,
          contextLength,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(agentConfig.id, "global"))
        .run()
    } else {
      await db
        .insert(agentConfig)
        .values({
          id: "global",
          modelId,
          modelName,
          provider,
          promptCost,
          completionCost,
          contextLength,
          updatedBy: user.id,
          updatedAt: now,
        })
        .run()
    }

    revalidatePath("/")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to set model",
    }
  }
}

export async function getModelList(): Promise<{
  success: true
  data: ReadonlyArray<ProviderGroup>
} | {
  success: false
  error: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (
      cachedModels &&
      Date.now() - cacheTimestamp < CACHE_TTL_MS
    ) {
      return { success: true, data: cachedModels }
    }

    const { env } = await getCloudflareContext()
    const apiKey = (
      env as unknown as Record<string, string>
    ).OPENROUTER_API_KEY

    if (!apiKey) {
      return {
        success: false,
        error: "OPENROUTER_API_KEY not configured",
      }
    }

    const res = await fetch(
      "https://openrouter.ai/api/v1/models",
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    )

    if (!res.ok) {
      if (cachedModels) {
        return { success: true, data: cachedModels }
      }
      return {
        success: false,
        error: `OpenRouter API error: ${res.status}`,
      }
    }

    const json = (await res.json()) as {
      data: ReadonlyArray<{
        id: string
        name: string
        context_length: number
        pricing: {
          prompt: string
          completion: string
        }
      }>
    }

    const groupMap = new Map<string, ModelInfo[]>()

    for (const m of json.data) {
      const slashIdx = m.id.indexOf("/")
      const providerSlug =
        slashIdx > 0 ? m.id.slice(0, slashIdx) : "other"
      const providerName = formatProvider(providerSlug)

      const info: ModelInfo = {
        id: m.id,
        name: m.name,
        provider: providerName,
        contextLength: m.context_length,
        promptCost: m.pricing.prompt,
        completionCost: m.pricing.completion,
      }

      const existing = groupMap.get(providerName)
      if (existing) {
        existing.push(info)
      } else {
        groupMap.set(providerName, [info])
      }
    }

    const groups: ReadonlyArray<ProviderGroup> = Array.from(
      groupMap.entries()
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, models]) => ({
        provider,
        models: models.sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      }))

    cachedModels = groups
    cacheTimestamp = Date.now()

    return { success: true, data: groups }
  } catch (err) {
    if (cachedModels) {
      return { success: true, data: cachedModels }
    }
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to fetch models",
    }
  }
}

export async function getUsageMetrics(
  days = 30
): Promise<{
  success: true
  data: UsageMetrics
} | {
  success: false
  error: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return {
        success: false,
        error: "Permission denied",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString()

    const rows = await db
      .select()
      .from(agentUsage)
      .where(gte(agentUsage.createdAt, cutoffStr))
      .orderBy(desc(agentUsage.createdAt))
      .all()

    let totalTokens = 0
    let totalCost = 0

    const dailyMap = new Map<
      string,
      { tokens: number; cost: number; requests: number }
    >()
    const modelMap = new Map<
      string,
      { tokens: number; cost: number; requests: number }
    >()

    for (const row of rows) {
      totalTokens += row.totalTokens
      totalCost += parseFloat(row.estimatedCost)

      const date = row.createdAt.slice(0, 10)
      const daily = dailyMap.get(date) ?? {
        tokens: 0,
        cost: 0,
        requests: 0,
      }
      daily.tokens += row.totalTokens
      daily.cost += parseFloat(row.estimatedCost)
      daily.requests += 1
      dailyMap.set(date, daily)

      const model = modelMap.get(row.modelId) ?? {
        tokens: 0,
        cost: 0,
        requests: 0,
      }
      model.tokens += row.totalTokens
      model.cost += parseFloat(row.estimatedCost)
      model.requests += 1
      modelMap.set(row.modelId, model)
    }

    return {
      success: true,
      data: {
        totalRequests: rows.length,
        totalTokens,
        totalCost: totalCost.toFixed(4),
        dailyBreakdown: Array.from(dailyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, d]) => ({
            date,
            tokens: d.tokens,
            cost: d.cost.toFixed(4),
            requests: d.requests,
          })),
        modelBreakdown: Array.from(modelMap.entries())
          .sort(
            ([, a], [, b]) => b.requests - a.requests
          )
          .map(([modelId, d]) => ({
            modelId,
            tokens: d.tokens,
            cost: d.cost.toFixed(4),
            requests: d.requests,
          })),
      },
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get metrics",
    }
  }
}

export async function getConversationUsage(
  conversationId: string
): Promise<{
  success: true
  data: ReadonlyArray<{
    modelId: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    estimatedCost: string
    createdAt: string
  }>
} | {
  success: false
  error: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const isAdmin = can(user, "agent", "update")

    const rows = await db
      .select()
      .from(agentUsage)
      .where(
        isAdmin
          ? eq(agentUsage.conversationId, conversationId)
          : and(
              eq(
                agentUsage.conversationId,
                conversationId
              ),
              eq(agentUsage.userId, user.id)
            )
      )
      .orderBy(desc(agentUsage.createdAt))
      .all()

    return {
      success: true,
      data: rows.map((r) => ({
        modelId: r.modelId,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        estimatedCost: r.estimatedCost,
        createdAt: r.createdAt,
      })),
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get usage",
    }
  }
}

// --- model policy ---

export async function updateModelPolicy(
  maxCostPerMillion: string | null,
  allowUserSelection: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return {
        success: false,
        error: "Permission denied",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const existing = await db
      .select({ id: agentConfig.id })
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    if (existing) {
      await db
        .update(agentConfig)
        .set({
          maxCostPerMillion,
          allowUserSelection: allowUserSelection
            ? 1
            : 0,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(agentConfig.id, "global"))
        .run()
    } else {
      const {
        DEFAULT_MODEL_ID,
      } = await import("@/lib/agent/provider")
      await db
        .insert(agentConfig)
        .values({
          id: "global",
          modelId: DEFAULT_MODEL_ID,
          modelName: "Default",
          provider: "default",
          promptCost: "0",
          completionCost: "0",
          contextLength: 0,
          maxCostPerMillion,
          allowUserSelection: allowUserSelection
            ? 1
            : 0,
          updatedBy: user.id,
          updatedAt: now,
        })
        .run()
    }

    revalidatePath("/")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update policy",
    }
  }
}

// --- user model preference ---

export async function getUserModelPreference(): Promise<{
  success: true
  data: {
    modelId: string
    promptCost: string
    completionCost: string
  } | null
} | {
  success: false
  error: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const pref = await db
      .select()
      .from(userModelPreference)
      .where(eq(userModelPreference.userId, user.id))
      .get()

    return {
      success: true,
      data: pref
        ? {
            modelId: pref.modelId,
            promptCost: pref.promptCost,
            completionCost: pref.completionCost,
          }
        : null,
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get preference",
    }
  }
}

export async function setUserModelPreference(
  modelId: string,
  promptCost: string,
  completionCost: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    const isAdmin = can(user, "agent", "update")

    if (
      !isAdmin &&
      config &&
      config.allowUserSelection !== 1
    ) {
      return {
        success: false,
        error: "User model selection is disabled",
      }
    }

    if (config?.maxCostPerMillion) {
      const ceiling = parseFloat(
        config.maxCostPerMillion
      )
      const outputPerMillion =
        parseFloat(completionCost) * 1_000_000
      if (outputPerMillion > ceiling) {
        return {
          success: false,
          error: `Model exceeds cost ceiling of $${config.maxCostPerMillion}/M`,
        }
      }
    }

    const now = new Date().toISOString()

    await db
      .insert(userModelPreference)
      .values({
        userId: user.id,
        modelId,
        promptCost,
        completionCost,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userModelPreference.userId,
        set: {
          modelId,
          promptCost,
          completionCost,
          updatedAt: now,
        },
      })
      .run()

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to save preference",
    }
  }
}

export async function clearUserModelPreference(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(userModelPreference)
      .where(eq(userModelPreference.userId, user.id))
      .run()

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to clear preference",
    }
  }
}

// --- helpers ---

function formatProvider(slug: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    meta: "Meta",
    mistralai: "Mistral",
    qwen: "Alibaba (Qwen)",
    deepseek: "DeepSeek",
    cohere: "Cohere",
    "x-ai": "xAI",
    nvidia: "NVIDIA",
    microsoft: "Microsoft",
    amazon: "Amazon",
    perplexity: "Perplexity",
    moonshotai: "Moonshot",
  }
  return (
    map[slug] ??
    slug.charAt(0).toUpperCase() + slug.slice(1)
  )
}
