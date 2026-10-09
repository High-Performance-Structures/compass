import type { ToolDef } from "./tools"
import type { McpClientManager } from "./mcp/types"

/** Provider-neutral tool definition sent to the model. */
export interface ApiTool {
  readonly name: string
  readonly description: string
  readonly input_schema: Readonly<Record<string, unknown>>
}

export interface ToolCallOutcome {
  /** Parsed result streamed to the browser as a tool_result event. */
  readonly output: unknown
  /** Raw result text returned to the model. */
  readonly content: string
  readonly isError: boolean
}

export interface ToolRegistry {
  readonly apiTools: readonly ApiTool[]
  execute(name: string, input: unknown): Promise<ToolCallOutcome>
}

/**
 * Collects direct tools and MCP tools into one list for the model and one
 * dispatcher for execution. Direct tools win when names collide. Shared by
 * the Anthropic-format loop and the OpenAI loop so both run tools the same way.
 */
export function createToolRegistry(
  tools: readonly ToolDef[] | undefined,
  mcpManager: McpClientManager | undefined,
): ToolRegistry {
  const toolMap = new Map<
    string,
    (input: unknown) => Promise<string> | string
  >()
  const apiTools: ApiTool[] = []

  for (const tool of tools ?? []) {
    toolMap.set(tool.name, tool.run)
    apiTools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })
  }

  if (mcpManager) {
    for (const tool of mcpManager.listTools()) {
      if (toolMap.has(tool.name)) continue
      apiTools.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })
    }
  }

  async function execute(
    name: string,
    input: unknown,
  ): Promise<ToolCallOutcome> {
    const runFn = toolMap.get(name)

    // Route: direct tool -> MCP manager -> unknown
    if (!runFn && !mcpManager) {
      const content = JSON.stringify({ error: `Unknown tool: ${name}` })
      return { output: content, content, isError: true }
    }

    try {
      const result = runFn
        ? await runFn(input)
        : mcpManager
          ? await mcpManager.callTool(name, input)
          : JSON.stringify({ error: `Unknown tool: ${name}` })
      let parsed: unknown
      try {
        parsed = JSON.parse(result)
      } catch {
        parsed = result
      }
      return { output: parsed, content: result, isError: false }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        output: { error: errorMsg },
        content: JSON.stringify({ error: errorMsg }),
        isError: true,
      }
    }
  }

  return { apiTools, execute }
}
