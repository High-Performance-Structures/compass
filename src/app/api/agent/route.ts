/**
 * Cloud-mode agent API route.
 * Runs on Cloudflare Workers via OpenNext. Uses agent-core
 * for the agentic loop with MCP-based tool routing.
 */

import { getCurrentUser } from "@/lib/auth"
import { getProviderConfigForJwt } from "@/app/actions/provider-config"
import { generateAgentToken } from "@/lib/agent/api-auth"
import { getCloudflareContext } from "@opennextjs/cloudflare"
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

  // Resolve provider config from DB
  let providerConfig = await getProviderConfigForJwt(
    user.id
  )
  if (!providerConfig) {
    providerConfig = await getProviderConfigForJwt(
      "org_default"
    )
  }

  const provider: ProviderConfig = providerConfig
    ? {
        type: mapProviderType(providerConfig.type),
        apiKey: providerConfig.apiKey ?? undefined,
        baseUrl: providerConfig.baseUrl ?? undefined,
        modelOverrides:
          providerConfig.modelOverrides ?? undefined,
      }
    : { type: "anthropic" }

  // Generate JWT for bridge route auth
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<
    string,
    string
  >
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

  const stream = runAgent({
    provider,
    model,
    systemPrompt,
    messages: msgs,
    mcpClientManager: manager,
  })

  // Wrap stream to disconnect MCP after completion
  const sseStream = createSSEStream(stream)
  const wrappedStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = sseStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
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
