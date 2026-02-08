AI Agent
===

The AI agent is the centerpiece of Compass. It's not a chatbot bolted onto a CRUD app -- it's the primary interface for interacting with the platform. Users ask it to pull data, navigate pages, build dashboards, manage themes, install skills, and remember preferences. The agent has tools for all of these things, and the system prompt tells it when to use each one.

This document covers the full stack: provider configuration, tool definitions, system prompt architecture, the API route, chat persistence, the unified chat UI architecture, and AI SDK v6 patterns.


provider setup
---

Compass routes all LLM calls through OpenRouter, which means any model OpenRouter supports can be the agent's brain. The provider configuration lives in `src/lib/agent/provider.ts`.

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

export const DEFAULT_MODEL_ID = "qwen/qwen3-coder-next"

export function createModelFromId(apiKey: string, modelId: string) {
  const openrouter = createOpenRouter({ apiKey })
  return openrouter(modelId, {
    provider: { allow_fallbacks: false },
  })
}
```

`allow_fallbacks: false` is deliberate. OpenRouter can silently fall back to a different model if the requested one is unavailable. This would break the cost tracking and prompt tuning, so we disable it.

The model is configurable at two levels:

1. **Global config.** A singleton row in `agent_config` (id = "global") sets the default model for all users. Admins can change this through the settings UI.

2. **Per-user override.** Users can select their own model via `user_model_preference`. The override is subject to a cost ceiling -- if the admin sets `maxCostPerMillion` in the global config, user-selected models that exceed this ceiling are silently downgraded to the global default.

```typescript
export async function resolveModelForUser(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<string> {
  const config = await db
    .select()
    .from(agentConfig)
    .where(eq(agentConfig.id, "global"))
    .get()

  if (!config) return DEFAULT_MODEL_ID

  const pref = await db
    .select()
    .from(userModelPreference)
    .where(eq(userModelPreference.userId, userId))
    .get()

  if (!pref) return config.modelId

  // enforce cost ceiling
  if (ceiling !== null) {
    const outputPerMillion = parseFloat(pref.completionCost) * 1_000_000
    if (outputPerMillion > ceiling) return config.modelId
  }

  return pref.modelId
}
```

This design means the admin controls the budget, and users control the experience within that budget.


tools
---

The agent's tools are defined in `src/lib/agent/tools.ts`. Each tool uses the AI SDK's `tool()` function with a Zod v4 schema for input validation.

The tools break into categories:

**Data access**

- `queryData` -- queries the database for customers, vendors, projects, invoices, vendor bills, schedule tasks, or record details. Takes a `queryType` enum, optional `search` string, optional `id` for detail queries, and optional `limit`. This is the agent's read interface to the application database.

**Navigation**

- `navigateTo` -- tells the client to navigate to a specific page. Validates against a whitelist of routes using regex patterns. Returns `{ action: "navigate", path, reason }` which the client-side action dispatcher intercepts and executes.

**UI generation**

- `generateUI` -- the most powerful tool. Takes a text description and optional data context, returns `{ action: "generateUI", renderPrompt, dataContext }`. The client intercepts this, sends the render prompt to a separate `/api/agent/render` endpoint that generates a JSON UI spec (json-render format), and streams the result into the dashboard area.

- `saveDashboard` / `listDashboards` / `editDashboard` / `deleteDashboard` -- CRUD for persisted dashboards built with `generateUI`.

**Notifications**

- `showNotification` -- triggers a toast notification on the client.

**Memory**

- `rememberContext` -- saves a preference, decision, fact, or workflow to persistent memory (the `slab_memories` table). The system prompt instructs the agent to use this proactively when users share information worth retaining.

- `recallMemory` -- searches persistent memories by keyword. Used when the user asks "do you remember..." or when the agent needs to look up a past preference.

**Skills/Plugins**

- `installSkill` / `uninstallSkill` / `toggleInstalledSkill` / `listInstalledSkills` -- manage the plugin/skills system. Install and uninstall require admin role.

**Theming**

- `listThemes` / `setTheme` -- list available themes and switch the active one.
- `generateTheme` -- create a custom theme from scratch. Accepts complete light/dark oklch color maps (32 keys each), font families, optional Google Font names, and design tokens. Saves to the database and returns a preview action.
- `editTheme` -- incrementally edit an existing custom theme. Only changed properties need to be provided; the rest are preserved via deep merge.

All tools follow the same pattern: validate input via Zod schema, do the work (query DB, check permissions), return an action object that the client-side dispatcher handles. The agent never directly manipulates the DOM or calls browser APIs -- it returns declarative action objects that the client interprets.


system prompt architecture
---

The system prompt is assembled by `buildSystemPrompt()` in `src/lib/agent/system-prompt.ts`. This follows the same section-builder pattern documented in OpenClaw's architecture: independent functions each return a string array, and the assembler concatenates and filters.

```typescript
export function buildSystemPrompt(ctx: PromptContext): string {
  const state = computeDerivedState(ctx)

  const sections: ReadonlyArray<ReadonlyArray<string>> = [
    buildIdentity(state.mode),
    buildUserContext(ctx, state),
    buildMemoryContext(ctx, state.mode),
    buildFirstInteraction(state.mode, state.page),
    buildDomainKnowledge(state.mode),
    buildToolDocs(state.tools),
    buildCatalogSection(state.mode, state.catalogComponents),
    buildInterviewProtocol(state.mode),
    buildGitHubGuidance(state.mode),
    buildThemingRules(state.mode),
    buildDashboardRules(ctx, state.mode),
    buildGuidelines(state.mode),
    buildPluginSections(ctx.pluginSections, state.mode),
  ]

  return sections
    .filter((s) => s.length > 0)
    .map((s) => s.join("\n"))
    .join("\n\n")
}
```

**Prompt modes.** Three modes control how much of the prompt is included:

- `"full"` -- everything. Used for the main chat interaction.
- `"minimal"` -- only data, navigation, and UI tools. Strips memory, domain knowledge, interview protocol, theming rules, and plugin sections.
- `"none"` -- a single identity line. For cases where injected context does the heavy lifting.

**The sections in detail:**

*Identity* -- "You are Dr. Slab Diggems, the AI assistant built into Compass." The agent has a name and a personality: reliable, direct, always ready to help.

*User context* -- injects the user's name, role, current page, current date/time, and timezone. This is what makes the agent aware of who it's talking to and where they are in the app.

*Memory context* -- in full mode, includes the user's saved memories. If no memories exist, the prompt tells the agent to start saving them when relevant information appears.

*First interaction* -- suggestions for what the agent can do when a user first messages. Tailored to the current page (project page gets project suggestions, financials page gets invoice suggestions).

*Domain knowledge* -- construction management terminology. The agent knows about phases, change orders, submittals, RFIs, and punch lists.

*Tool docs* -- auto-generated from a `TOOL_REGISTRY` array. Each tool gets a name, summary, category, and optional `adminOnly` flag. In minimal mode, only data/navigation/UI tools are included. Admin-only tools are filtered out for non-admin users.

*Catalog section* -- lists the components available for `generateUI` (DataTable, StatCard, BarChart, Form, Input, Checkbox, etc.) with usage examples for interactive patterns (creating records, editing, inline toggles, row actions).

*Interview protocol* -- instructions for conducting UX research interviews. The agent asks one question at a time, covers specific areas, and saves results via `saveInterviewFeedback`.

*GitHub guidance* -- rate limit awareness and instructions to translate developer jargon into business language for construction professionals.

*Theming rules* -- detailed instructions for `generateTheme` (all 32 oklch color keys, contrast requirements, chart color distinctness) and `editTheme` (partial updates, deep merge behavior).

*Dashboard rules* -- workflow for building, saving, editing, and loading custom dashboards. Includes limits (5 per user) and UX guidance (when to offer saving).

*Guidelines* -- behavioral rules. The most important: "ACT FIRST, don't ask." When the user requests data, the agent should call `queryData` immediately, not ask clarifying questions. This is the difference between a helpful tool and an annoying chatbot.

*Plugin sections* -- injected at priority 80 from installed skills. Each skill's SKILL.md content gets parsed and added as a prompt section.


the API route
---

The streaming endpoint lives at `src/app/api/agent/route.ts`. It handles a single concern: take messages in, stream responses out.

```typescript
export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { env, ctx } = await getCloudflareContext()
  const db = getDb(env.DB)

  // resolve model, load memories, get plugin registry, fetch dashboards
  const [memories, registry, dashboardResult] =
    await Promise.all([
      loadMemoriesForPrompt(db, user.id),
      getRegistry(db, envRecord),
      getCustomDashboards(),
    ])

  const result = streamText({
    model,
    system: buildSystemPrompt({ /* full context */ }),
    messages: await convertToModelMessages(body.messages),
    tools: {
      ...agentTools,
      ...githubTools,
      ...pluginTools,
    },
    toolChoice: "auto",
    stopWhen: stepCountIs(10),
    onError({ error }) { /* log with model context */ },
  })

  ctx.waitUntil(
    saveStreamUsage(db, conversationId, user.id, modelId, result)
  )

  return result.toUIMessageStreamResponse({ /* error mapping */ })
}
```

Key details:

**Parallel loading.** Memories, plugin registry, and dashboard data are loaded concurrently with `Promise.all()`. This cuts the cold-start latency by ~60% compared to sequential loading.

**Multi-tool loop.** `stopWhen: stepCountIs(10)` allows the agent up to 10 back-and-forth steps (call tool, get result, call another tool, etc.) before the response is finalized. This is what enables complex workflows like "query data, then build a dashboard with it."

**Plugin tool injection.** The plugin registry provides additional tools from installed skills. These are spread into the tools object alongside the built-in tools, so the agent can use them transparently.

**Usage tracking.** `saveStreamUsage()` runs via `ctx.waitUntil()` so it doesn't block the response stream. It records token counts and cost estimates per invocation.

**Client headers.** The request includes `x-current-page`, `x-timezone`, and `x-conversation-id` as custom headers. These flow into the system prompt context so the agent knows the user's current location and timezone.

**Error handling.** The `onError` callback unwraps `APICallError` (from the provider) and `RetryError` (from the SDK's retry logic) to log meaningful error messages with model context. The `toUIMessageStreamResponse` error handler maps these to user-facing error strings.


chat persistence
---

Conversations are persisted to D1 via server actions in `src/app/actions/agent.ts`:

- `saveConversation(conversationId, messages, title?)` -- upserts the conversation row and replaces all message rows. The delete-and-reinsert pattern is simpler than diffing.
- `loadConversations()` -- returns the user's 20 most recent conversations, ordered by last message time.
- `loadConversation(conversationId)` -- returns all messages for a conversation, with parts metadata restored from JSON.
- `deleteConversation(conversationId)` -- cascade deletes the conversation and all its messages.

Messages are stored in `agent_memories` with the role, content (text only), and full parts array (JSON in the metadata column). The parts array preserves tool calls, reasoning, and other non-text content so conversations can be fully restored.


the unified chat architecture
---

This is the most architecturally interesting part of the UI layer. There's one chat component (`ChatView`) that renders in two completely different modes depending on a `variant` prop.

**Page variant** (`variant="page"`) -- renders on `/dashboard` as a full-page experience with an idle hero state (animated typewriter placeholder, repo stats from GitHub) that transitions to an active conversation state.

**Panel variant** (`variant="panel"`) -- renders in `ChatPanelShell` as a resizable sidebar on every other page. Keyboard shortcut (Cmd+.) to toggle, mobile FAB button, resize handle (320-720px range).

Both variants share all chat state through the same hook and context. Navigating from the dashboard to a project page seamlessly moves the conversation from full-page to sidebar without losing any messages.

The state architecture has three layers, all provided by `ChatProvider`:

```
ChatProvider
  ├── PanelContext     (isOpen, open, close, toggle)
  ├── ChatStateContext (messages, sendMessage, status, conversationId, newChat)
  └── RenderContext    (spec, isRendering, triggerRender, clearRender, loadSpec)
```

**PanelContext** manages the sidebar open/close state. It auto-opens the panel when navigating away from the dashboard with existing messages.

**ChatStateContext** wraps `useCompassChat()`, which wraps `useChat()` from AI SDK. It adds conversation ID management, new-chat functionality, and persistence callbacks.

**RenderContext** manages the json-render stream for `generateUI`. When the agent calls `generateUI`, the `ChatProvider` detects the tool result, sends the render prompt to `/api/agent/render`, and streams the resulting UI spec into the dashboard area.


the useCompassChat hook
---

`src/hooks/use-compass-chat.ts` is the shared hook that wraps AI SDK's `useChat()`:

```typescript
export function useCompassChat(options?: UseCompassChatOptions) {
  const pathname = usePathname()
  const router = useRouter()

  const chatState = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      headers: {
        "x-current-page": pathname,
        "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        "x-conversation-id": options?.conversationId ?? "",
      },
    }),
    onFinish: options?.onFinish,
    onError: (err) => toast.error(err.message),
  })

  // dispatch tool-based client actions on new messages
  useEffect(() => {
    const last = chatState.messages.at(-1)
    if (last?.role !== "assistant") return
    dispatchToolActions(last.parts, dispatchedRef.current)
  }, [chatState.messages])

  // initialize action handlers (navigate, toast, etc.)
  useEffect(() => {
    initializeActionHandlers(
      () => routerRef.current,
      () => openPanelRef.current?.()
    )
    // ...
  }, [])

  return {
    messages: chatState.messages,
    setMessages: chatState.setMessages,
    sendMessage: chatState.sendMessage,
    // ...
    isGenerating,
  }
}
```

The hook does three things beyond what `useChat()` provides:

1. **Injects request context** (current page, timezone, conversation ID) as HTTP headers.
2. **Dispatches tool actions** by scanning assistant message parts for tool results with known action types (navigate, toast, generateUI, etc.).
3. **Registers action handlers** that translate action types into browser operations (router.push, window.dispatchEvent, etc.).


the action dispatch system
---

`src/lib/agent/chat-adapter.ts` is the bridge between tool results (server-side) and browser actions (client-side).

When a tool returns `{ action: "navigate", path: "/dashboard/projects" }`, the dispatch system:

1. Scans the assistant message's parts array for tool parts with `state: "output-available"`
2. Checks if the output has an `action` field
3. Maps the action to an `executeAction()` call with the appropriate type
4. The registered handler for `NAVIGATE_TO` calls `router.push(path)`

The handler registry supports: `NAVIGATE_TO`, `SHOW_TOAST`, `OPEN_MODAL`, `CLOSE_MODAL`, `SCROLL_TO`, `FOCUS_ELEMENT`, `GENERATE_UI`, `SAVE_DASHBOARD`, `LOAD_DASHBOARD`, `APPLY_THEME`, `PREVIEW_THEME`.

A `Set<string>` of dispatched tool call IDs prevents re-execution on React re-renders. Each tool result is dispatched exactly once.

AI SDK v6 has two tool part formats that the dispatch system handles:
- Static parts: `type: "tool-queryData"`, properties are flat on the part object
- Dynamic parts: `type: "dynamic-tool"`, `toolName` field, same structure otherwise


AI SDK v6 patterns and gotchas
---

Compass uses AI SDK v6, which has significant API differences from v5. These are the patterns that matter:

**Tool definitions use `inputSchema`, not `parameters`:**

```typescript
const myTool = tool({
  description: "...",
  inputSchema: z.object({ /* ... */ }),  // not `parameters`
  execute: async (input) => { /* ... */ },
})
```

**Zod must come from `zod/v4`:** AI SDK v6 internally uses Zod v4 for schema validation. If you import from `zod` instead of `zod/v4`, runtime validation fails silently.

**`useChat()` requires a transport, not an `api` prop:**

```typescript
useChat({
  transport: new DefaultChatTransport({ api: "/api/agent" }),
  // NOT: api: "/api/agent"
})
```

**Messages are sent with `sendMessage({ text })`, not `append({ role, content })`.**

**Status is a string enum, not a boolean:**

```typescript
chatState.status  // "streaming" | "submitted" | "ready" | "error"
// NOT: chatState.isGenerating
```

The `isGenerating` convenience boolean is computed in `useCompassChat`:

```typescript
const isGenerating =
  chatState.status === "streaming" ||
  chatState.status === "submitted"
```

**`UIMessage` uses a `parts` array, not a `content` field.** Text extraction requires filtering parts by type:

```typescript
export function getTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>
): string {
  return parts
    .filter((p): p is { type: "text"; text: string } =>
      p.type === "text"
    )
    .map((p) => p.text)
    .join("")
}
```

**`convertToModelMessages()` expects a mutable array.** The SDK's type signature requires `UIMessage[]`, not `ReadonlyArray<UIMessage>`. The API route handles this by receiving the messages as a mutable type from the request body.

**Environment variable access needs a double cast:**

```typescript
const envRecord = env as unknown as Record<string, string>
const apiKey = envRecord.OPENROUTER_API_KEY
```

This is because the Cloudflare env type doesn't include manually-set secrets.
