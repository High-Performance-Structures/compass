/**
 * Cloud-mode agent API route.
 * Runs on Cloudflare Workers via OpenNext. Uses agent-core
 * for the agentic loop with MCP-based tool routing.
 */

import { getCurrentUser } from "@/lib/auth"
import { getProviderConfigForJwt } from "@/app/actions/provider-config"
import { getOAuthAccessToken } from "@/app/actions/anthropic-oauth"
import { generateAgentToken } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { mcpServers } from "@/db/schema-mcp"
import { eq } from "drizzle-orm"
import {
  runAgent,
  buildSystemPrompt,
  createSSEStream,
  createCompassServer,
  createClientManager,
} from "agent-core"
import type {
  DataSource,
  ProviderConfig,
  McpServerConfig,
} from "agent-core"

interface ChatRequest {
  readonly messages: ReadonlyArray<{
    readonly role: "user" | "assistant"
    readonly content: string
  }>
}

function mapProviderType(
  type: string
): ProviderConfig["type"] {
  switch (type) {
    case "anthropic-key":
    case "anthropic-oauth":
      return "anthropic"
    case "openrouter":
      return "openrouter"
    case "ollama":
      return "ollama"
    default:
      return "custom"
  }
}

/**
 * Resolves short model names (sonnet, opus, haiku) to full model IDs
 * based on the provider type. Passes through full model IDs unchanged.
 */
function resolveModelId(
  model: string,
  providerType: string
): string {
  // If already a full model ID, use as-is
  if (model.includes("/") || model.startsWith("claude-")) {
    return model
  }

  // Map short names to full IDs
  const anthropicModels: Record<string, string> = {
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-opus-4-20250514",
    haiku: "claude-3-5-haiku-20241022",
  }

  const openrouterModels: Record<string, string> = {
    sonnet: "anthropic/claude-sonnet-4",
    opus: "anthropic/claude-opus-4",
    haiku: "anthropic/claude-3.5-haiku",
  }

  if (
    providerType === "anthropic" ||
    providerType === "anthropic-oauth" ||
    providerType === "anthropic-key"
  ) {
    return anthropicModels[model] ?? model
  }

  if (providerType === "openrouter") {
    return openrouterModels[model] ?? model
  }

  // Ollama and custom use the model as-is
  return model
}

export async function POST(
  request: Request
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  let body: ChatRequest
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  if (
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return new Response(
      JSON.stringify({
        error:
          "messages array is required and cannot be empty",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const model =
    request.headers.get("x-model") ?? "sonnet"
  const currentPage =
    request.headers.get("x-current-page") ?? "/dashboard"
  const timezone =
    request.headers.get("x-timezone") ?? "UTC"

  // Get env context early for fallback
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<
    string,
    string
  >

  // Resolve provider config from DB
  let providerConfig = await getProviderConfigForJwt(
    user.id
  )
  if (!providerConfig) {
    providerConfig = await getProviderConfigForJwt(
      "org_default"
    )
  }

  let provider: ProviderConfig = providerConfig
    ? {
        type: mapProviderType(providerConfig.type),
        apiKey: providerConfig.apiKey ?? undefined,
        baseUrl: providerConfig.baseUrl ?? undefined,
        modelOverrides:
          providerConfig.modelOverrides ?? undefined,
      }
    : {
        type: "anthropic",
        apiKey: envRecord.ANTHROPIC_API_KEY,
      }

  // Log warning if no API key available (unless using OAuth which handles its own auth)
  if (
    !provider.apiKey &&
    providerConfig?.type !== "anthropic-oauth"
  ) {
    console.warn(
      "No API key configured for agent - requests may fail"
    )
  }

  // Resolve OAuth access token if needed
  if (providerConfig?.type === "anthropic-oauth") {
    const accessToken = await getOAuthAccessToken(user.id)
    if (!accessToken) {
      return new Response(
        JSON.stringify({
          error: "Anthropic OAuth not connected or token expired",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      )
    }
    provider = {
      type: "anthropic",
      apiKey: accessToken,
    }
  }

  // Generate JWT for bridge route auth
  const agentSecret = envRecord.AGENT_AUTH_SECRET
  if (!agentSecret) {
    return new Response(
      JSON.stringify({
        error: "AGENT_AUTH_SECRET not configured",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const token = await generateAgentToken(
    agentSecret,
    user.id,
    user.organizationId ?? "",
    user.role,
    false
  )

  const baseUrl =
    envRecord.COMPASS_API_BASE_URL ??
    request.headers.get("origin") ??
    ""

  const dataSource: DataSource = {
    async fetch(
      path: string,
      fetchBody?: unknown
    ): Promise<unknown> {
      const res = await fetch(`${baseUrl}${path}`, {
        method: fetchBody ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: fetchBody
          ? JSON.stringify(fetchBody)
          : undefined,
      })
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: res.statusText }))
        const errObj = err as { error?: string }
        throw new Error(
          errObj.error ?? `API error ${res.status}`
        )
      }
      return res.json()
    },
  }

  // Set up MCP-based tool routing
  const compassServer = createCompassServer(dataSource)
  const manager = createClientManager(compassServer)

  // Load external MCP servers from DB (HTTP only on Workers)
  const mcpConfigs: McpServerConfig[] = [
    {
      name: "compass",
      transport: { type: "in-memory" },
      enabled: true,
    },
  ]

  if (user.organizationId) {
    try {
      const db = getDb(env.DB)
      const rows = await db
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.orgId, user.organizationId))
        .all()

      for (const row of rows) {
        if (!row.isEnabled) continue
        // Workers can't spawn processes — skip stdio
        if (row.transport === "stdio") continue
        if (row.transport === "http" && row.url) {
          const headers = row.headers
            ? (JSON.parse(row.headers) as Record<
                string,
                string
              >)
            : undefined
          mcpConfigs.push({
            name: row.slug,
            transport: {
              type: "http",
              url: row.url,
              headers,
            },
            enabled: true,
          })
        }
      }
    } catch (err) {
      console.error(
        "Failed to load external MCP servers:",
        err
      )
    }
  }

  await manager.connect(mcpConfigs)

  // Identify external tools for system prompt
  const allTools = manager.listTools()
  const externalMcpTools = allTools
    .filter((t) => t.serverName !== "compass")
    .map((t) => ({
      serverName: t.serverName,
      name: t.name,
    }))

  const msgs = body.messages as Array<{
    role: "user" | "assistant"
    content: string
  }>

  const systemPrompt = buildSystemPrompt({
    context: {
      userId: user.id,
      orgId: user.organizationId ?? "",
      role: user.role,
      isDemoUser: false,
      currentPage,
      timezone,
    },
    messages: msgs,
    externalMcpTools:
      externalMcpTools.length > 0
        ? externalMcpTools
        : undefined,
  })

  const isOAuth =
    provider.apiKey?.startsWith("sk-ant-oat") ?? false

  // Resolve short model names to full model IDs based on provider
  const resolvedModel = resolveModelId(
    model,
    providerConfig?.type ?? "anthropic"
  )

  const stream = runAgent({
    provider,
    model: resolvedModel,
    systemPrompt,
    messages: msgs,
    mcpClientManager: manager,
    isOAuth,
  })

  // Wrap stream to disconnect MCP after completion
  const sseStream = createSSEStream(stream)
  const encoder = new TextEncoder()
  const wrappedStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = sseStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
      } catch (err) {
        // Send error event before closing
        const errorEvent = `data: ${JSON.stringify({
          type: "error",
          error:
            err instanceof Error
              ? err.message
              : String(err),
        })}\n\n`
        controller.enqueue(encoder.encode(errorEvent))
      } finally {
        controller.close()
        await manager.disconnect()
      }
    },
  })

  return new Response(wrappedStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
