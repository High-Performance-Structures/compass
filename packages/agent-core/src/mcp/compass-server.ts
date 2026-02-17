import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type ListToolsResult,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js"
import { createTools } from "../tools"
import type { DataSource } from "../types"

// McpServer (high-level API) requires Zod schemas for tool registration.
// Our tools use JSON Schema (Record<string, unknown>), so we use the
// low-level Server with manual request handlers instead.

// Type predicates to convert our JSON Schema shape into the
// MCP-expected inputSchema type without using `as` assertions.
function isObjectRecord(val: unknown): val is Record<string, object> {
  return typeof val === "object" && val !== null && !Array.isArray(val)
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string")
}

function toInputSchema(
  raw: Record<string, unknown>,
): { type: "object"; properties?: Record<string, object>; required?: string[] } {
  const props = raw["properties"]
  const reqs = raw["required"]
  return {
    type: "object",
    ...(isObjectRecord(props) && { properties: props }),
    ...(isStringArray(reqs) && { required: reqs }),
  }
}

export function createCompassServer(dataSource: DataSource): Server {
  const server = new Server(
    { name: "compass", version: "1.0.0" },
    { capabilities: { tools: {} } },
  )

  const tools = createTools(dataSource)
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  server.setRequestHandler(
    ListToolsRequestSchema,
    (): ListToolsResult => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: toInputSchema(t.input_schema),
      })),
    }),
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req): Promise<CallToolResult> => {
      const tool = toolMap.get(req.params.name)
      if (tool === undefined) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
          isError: true,
        }
      }
      const result = await tool.run(req.params.arguments ?? {})
      return { content: [{ type: "text", text: result }] }
    },
  )

  return server
}
