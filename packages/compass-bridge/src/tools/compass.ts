// remote compass tool execution -- calls back to Compass cloud

import type { BridgeConfig } from "../config"

interface ToolResult {
  readonly success: boolean
  readonly result?: unknown
  readonly error?: string
}

export async function executeCompassTool(
  config: BridgeConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const url = `${config.compassUrl}/api/bridge/tools`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool: toolName, args }),
  })

  if (!res.ok) {
    return {
      success: false,
      error: `Tool call failed (${res.status})`,
    }
  }

  return res.json() as Promise<ToolResult>
}
