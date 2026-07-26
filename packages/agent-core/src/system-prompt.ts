import type { AgentContext } from "./types"

interface Message {
  readonly role: "user" | "assistant"
  readonly content: string
}

interface McpToolInfo {
  readonly serverName: string
  readonly name: string
}

interface SystemPromptOptions {
  readonly context: AgentContext
  readonly messages: readonly Message[]
  readonly externalMcpTools?: readonly McpToolInfo[]
}

export function buildSystemPrompt(
  contextOrOpts: AgentContext | SystemPromptOptions,
  messages?: readonly Message[]
): string {
  // Support both old and new call signatures
  const opts: SystemPromptOptions =
    "context" in contextOrOpts
      ? contextOrOpts
      : { context: contextOrOpts, messages: messages ?? [] }

  const ctx = opts.context
  const history = buildConversationHistory(opts.messages)
  const externalTools = buildExternalToolsSection(
    opts.externalMcpTools
  )

  return `You are Jarvis, the trusted project operations assistant inside \
Compass. Staff should experience one consistent assistant identity regardless \
of which internal model or provider handles a request. Never present yourself \
as the underlying model or provider.

Current context:
- User ID: ${ctx.userId}
- Organization: ${ctx.orgId}
- Role: ${ctx.role}
- Current page: ${ctx.currentPage}
- Timezone: ${ctx.timezone}

You have tools for querying data, navigating the UI, managing \
schedules, themes, memories, skills, dashboards, and GitHub \
integration.

When a tool returns an "action" field in its result, that action \
will be forwarded to the client for execution (navigation, toasts, \
UI generation, theme changes, etc.). You don't need to do anything \
extra \u2014 just call the tool and the action dispatches \
automatically.${externalTools}${history}`
}

function buildExternalToolsSection(
  tools?: readonly McpToolInfo[]
): string {
  if (!tools || tools.length === 0) return ""

  const byServer = new Map<string, string[]>()
  for (const tool of tools) {
    const list = byServer.get(tool.serverName) ?? []
    list.push(tool.name)
    byServer.set(tool.serverName, list)
  }

  const sections: string[] = []
  for (const [server, names] of byServer) {
    sections.push(
      `- ${server}: ${names.join(", ")}`
    )
  }

  return `\n\nExternal MCP servers connected:\n${sections.join("\n")}`
}

function buildConversationHistory(
  messages: readonly Message[]
): string {
  const history = messages.slice(0, -1)
  if (history.length === 0) return ""

  const lines = history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant"
    return `${role}: ${m.content}`
  })

  return `\n\nConversation so far:\n${lines.join("\n")}\n\nContinue the conversation naturally.`
}
