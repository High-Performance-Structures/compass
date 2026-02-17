/**
 * SSE streaming using agent-core's agentic loop with MCP-based
 * tool routing. Supports both in-process compass tools and
 * external MCP servers (stdio + HTTP).
 */

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
import type {
  AuthContext,
  ProviderConfig as JWTProvider,
} from "./auth"
import { compassApi } from "./api-client"
import { config } from "./config"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface ExternalServerConfig {
  readonly name: string
  readonly slug: string
  readonly transport: "stdio" | "http"
  readonly command?: string
  readonly args?: string
  readonly env?: string
  readonly url?: string
  readonly headers?: string
}

interface StreamContext {
  auth: AuthContext
  authToken: string
  sessionId: string
  currentPage: string
  timezone: string
  provider?: JWTProvider
  model: string
  externalServers?: readonly ExternalServerConfig[]
}

function mapProvider(context: StreamContext): ProviderConfig {
  if (!context.provider) {
    return {
      type: "anthropic",
      apiKey: config.anthropicApiKey,
      baseUrl: config.anthropicBaseUrl,
    }
  }

  switch (context.provider.type) {
    case "anthropic-key":
    case "anthropic-oauth":
      return {
        type: "anthropic",
        apiKey: context.provider.apiKey,
        baseUrl: context.provider.baseUrl,
      }
    case "openrouter":
      return {
        type: "openrouter",
        apiKey: context.provider.apiKey,
      }
    case "ollama":
      return {
        type: "ollama",
        baseUrl: context.provider.baseUrl,
      }
    default:
      return {
        type: "custom",
        apiKey: context.provider.apiKey,
        baseUrl: context.provider.baseUrl,
      }
  }
}

function buildExternalConfigs(
  servers?: readonly ExternalServerConfig[]
): McpServerConfig[] {
  if (!servers) return []

  const configs: McpServerConfig[] = []
  for (const s of servers) {
    if (s.transport === "stdio" && s.command) {
      const args = s.args
        ? (JSON.parse(s.args) as string[])
        : undefined
      const env = s.env
        ? (JSON.parse(s.env) as Record<string, string>)
        : undefined
      configs.push({
        name: s.slug,
        transport: {
          type: "stdio",
          command: s.command,
          args,
          env,
        },
        enabled: true,
      })
    } else if (s.transport === "http" && s.url) {
      const headers = s.headers
        ? (JSON.parse(s.headers) as Record<string, string>)
        : undefined
      configs.push({
        name: s.slug,
        transport: {
          type: "http",
          url: s.url,
          headers,
        },
        enabled: true,
      })
    }
  }
  return configs
}

export async function createAgentStream(
  messages: Message[],
  context: StreamContext
): Promise<ReadableStream<Uint8Array>> {
  const provider = mapProvider(context)

  const dataSource: DataSource = {
    async fetch(
      path: string,
      body?: unknown
    ): Promise<unknown> {
      return compassApi(
        config.compassApiBaseUrl,
        path,
        context.authToken,
        body
      )
    },
  }

  // Set up MCP-based tool routing
  const compassServer = createCompassServer(dataSource)
  const manager = createClientManager(compassServer)

  const mcpConfigs: McpServerConfig[] = [
    {
      name: "compass",
      transport: { type: "in-memory" },
      enabled: true,
    },
    ...buildExternalConfigs(context.externalServers),
  ]

  await manager.connect(mcpConfigs)

  // Identify external tools for system prompt
  const allTools = manager.listTools()
  const externalMcpTools = allTools
    .filter((t) => t.serverName !== "compass")
    .map((t) => ({
      serverName: t.serverName,
      name: t.name,
    }))

  const systemPrompt = buildSystemPrompt({
    context: {
      userId: context.auth.userId,
      orgId: context.auth.orgId,
      role: context.auth.role,
      isDemoUser: context.auth.isDemoUser,
      currentPage: context.currentPage,
      timezone: context.timezone,
    },
    messages,
    externalMcpTools:
      externalMcpTools.length > 0
        ? externalMcpTools
        : undefined,
  })

  const isOAuth =
    provider.apiKey?.startsWith("sk-ant-oat") ?? false

  const agentStream = runAgent({
    provider,
    model: context.model,
    systemPrompt,
    messages,
    mcpClientManager: manager,
    isOAuth,
  })

  // Wrap to disconnect MCP after stream ends
  const sseStream = createSSEStream(agentStream)
  return new ReadableStream<Uint8Array>({
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
}
