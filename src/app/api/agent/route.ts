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
import { agentConfig } from "@/db/schema-ai-config"
import { eq } from "drizzle-orm"
import { z } from "zod/v4"
import { can, canUseAskCompass } from "@/lib/permissions"
import {
  resolveRuntimeModelId,
  resolveRuntimeProvider,
  selectRuntimeModel,
} from "@/lib/agent/runtime-config"
import {
  createAgentRelayResponse,
  isJarvisAgentBridgeEnabled,
  relayAgentRequest,
} from "@/lib/jarvis/agent-relay"
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

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20_000),
      }),
    )
    .min(1)
    .max(100),
})

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
  if (!canUseAskCompass(user)) {
    return Response.json(
      { error: "Ask Compass is not available for this account" },
      { status: 403 }
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  const parsedBody = chatRequestSchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return new Response(
      JSON.stringify({
        error: "A valid messages array is required",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
  const body = parsedBody.data

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

  const db = getDb(env.DB)

  if (
    isJarvisAgentBridgeEnabled(
      envRecord.JARVIS_AGENT_BRIDGE_ENABLED,
    )
  ) {
    if (!envRecord.JARVIS_BRIDGE_SECRET) {
      return Response.json(
        { error: "Jarvis relay is not configured" },
        { status: 503 },
      )
    }

    const relayResult = await relayAgentRequest({
      db,
      organizationId: user.organizationId,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
      sessionId:
        request.headers.get("x-session-id") ?? crypto.randomUUID(),
      currentPage,
      timezone,
      messages: body.messages,
    })
    if (!relayResult.success) {
      return Response.json(
        { error: relayResult.error },
        { status: relayResult.timedOut ? 504 : 502 },
      )
    }
    return createAgentRelayResponse(relayResult.content)
  }

  const activeAgentConfig = await db
    .select({ modelId: agentConfig.modelId })
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()

  // Staff use the shared organizational provider. Administrators may keep a
  // personal provider for controlled testing from the settings screen.
  let providerConfig = can(user, "agent", "update")
    ? await getProviderConfigForJwt(user.id)
    : null
  if (!providerConfig) {
    providerConfig = await getProviderConfigForJwt(
      "org_default"
    )
  }

  let provider: ProviderConfig
  let runtimeProviderType: string

  // OAuth supplies its own token, so it must be resolved before checking
  // deployment API-key fallbacks.
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
    runtimeProviderType = "anthropic-oauth"
  } else {
    const runtimeProvider = resolveRuntimeProvider(
      providerConfig,
      envRecord
    )
    if (!runtimeProvider.success) {
      return Response.json(
        { error: runtimeProvider.error },
        { status: 503 }
      )
    }
    provider = runtimeProvider.provider
    runtimeProviderType = runtimeProvider.providerType
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

  const msgs = body.messages

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

  // The server-side active model is authoritative. The request header remains
  // only as a compatibility fallback for deployments without agent_config.
  const configuredModel = selectRuntimeModel(
    activeAgentConfig?.modelId,
    request.headers.get("x-model")
  )
  const resolvedModel = resolveRuntimeModelId(
    configuredModel,
    runtimeProviderType
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
