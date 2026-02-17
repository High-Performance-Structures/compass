import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { McpServerConfig, McpClientManager } from "./types"

interface ConnectedServer {
  readonly client: Client
  readonly toolNames: ReadonlySet<string>
}

interface ToolEntry {
  readonly name: string
  readonly description: string
  readonly input_schema: Record<string, unknown>
  readonly serverName: string
  readonly originalName: string
}

const COMPASS_SERVER_NAME = "compass"

export function createClientManager(
  compassServer?: Server
): McpClientManager {
  const servers = new Map<string, ConnectedServer>()
  const toolIndex = new Map<string, { serverName: string; originalName: string }>()
  let cachedTools: ToolEntry[] = []

  async function connectServer(
    config: McpServerConfig
  ): Promise<void> {
    const client = new Client({
      name: `compass-client-${config.name}`,
      version: "1.0.0",
    })

    const transport = config.transport

    if (transport.type === "in-memory") {
      if (!compassServer) {
        console.error(
          "in-memory transport requires compassServer"
        )
        return
      }
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair()
      await compassServer.connect(serverTransport)
      await client.connect(clientTransport)
    } else if (transport.type === "stdio") {
      const stdioTransport = new StdioClientTransport({
        command: transport.command,
        args: transport.args ? [...transport.args] : undefined,
        env: transport.env
          ? { ...transport.env }
          : undefined,
      })
      await client.connect(stdioTransport)
    } else if (transport.type === "http") {
      const httpTransport = new StreamableHTTPClientTransport(
        new URL(transport.url),
        transport.headers
          ? {
              requestInit: {
                headers: { ...transport.headers },
              },
            }
          : undefined
      )
      await client.connect(httpTransport)
    }

    const result = await client.listTools()
    const toolNames = new Set<string>()

    for (const tool of result.tools) {
      toolNames.add(tool.name)
    }

    servers.set(config.name, { client, toolNames })
  }

  function buildToolIndex(): void {
    toolIndex.clear()
    cachedTools = []

    for (const [serverName, server] of servers) {
      const isCompass = serverName === COMPASS_SERVER_NAME

      for (const toolName of server.toolNames) {
        const publicName = isCompass
          ? toolName
          : `${serverName}__${toolName}`

        toolIndex.set(publicName, {
          serverName,
          originalName: toolName,
        })
      }
    }
  }

  return {
    async connect(
      configs: readonly McpServerConfig[]
    ): Promise<void> {
      for (const config of configs) {
        if (!config.enabled) continue

        try {
          await connectServer(config)
        } catch (err) {
          console.error(
            `Failed to connect MCP server "${config.name}":`,
            err
          )
        }
      }

      buildToolIndex()

      // Fetch full tool metadata after index is built
      for (const [serverName, server] of servers) {
        const isCompass = serverName === COMPASS_SERVER_NAME

        try {
          const result = await server.client.listTools()
          for (const tool of result.tools) {
            const publicName = isCompass
              ? tool.name
              : `${serverName}__${tool.name}`

            cachedTools.push({
              name: publicName,
              description: tool.description ?? "",
              input_schema:
                (tool.inputSchema as Record<string, unknown>) ??
                {},
              serverName,
              originalName: tool.name,
            })
          }
        } catch (err) {
          console.error(
            `Failed to list tools from "${serverName}":`,
            err
          )
        }
      }
    },

    listTools(): Array<{
      name: string
      description: string
      input_schema: Record<string, unknown>
      serverName: string
    }> {
      return cachedTools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        serverName: t.serverName,
      }))
    },

    async callTool(
      name: string,
      input: unknown
    ): Promise<string> {
      const entry = toolIndex.get(name)
      if (!entry) {
        return JSON.stringify({
          error: `Unknown MCP tool: ${name}`,
        })
      }

      const server = servers.get(entry.serverName)
      if (!server) {
        return JSON.stringify({
          error: `MCP server "${entry.serverName}" not connected`,
        })
      }

      const result = await server.client.callTool({
        name: entry.originalName,
        arguments: input as Record<string, unknown>,
      })

      // Extract text content from MCP result
      const contents = result.content
      if (!Array.isArray(contents) || contents.length === 0) {
        return ""
      }

      const textParts: string[] = []
      for (const part of contents) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          textParts.push(part.text)
        }
      }

      return textParts.join("")
    },

    async disconnect(): Promise<void> {
      for (const [, server] of servers) {
        try {
          await server.client.close()
        } catch {
          // ignore close errors
        }
      }
      servers.clear()
      toolIndex.clear()
      cachedTools = []
    },
  }
}
