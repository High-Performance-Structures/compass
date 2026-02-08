OpenClaw Architecture
===

reference document covering OpenClaw's internal architecture, written during evaluation for Compass's AI backend. covers the agent framework, protocol layer, and authentication system. useful context if we integrate with or build on top of OpenClaw's gateway.


the stack at a glance
---

OpenClaw is three things layered on top of each other:

1. **pi-ai** - model abstraction. talks to Anthropic, OpenAI, Bedrock, and others through a single `getModel()` interface. handles streaming, token counting, the boring plumbing.

2. **pi-agent-core** - the agentic loop. takes a model, system prompt, and tools, then runs the standard prompt-stream-tool-repeat cycle. manages state, message history, tool execution, and event streaming. this is where the actual "agent" behavior lives.

3. **OpenClaw gateway** - the infrastructure wrapper. sessions, credential management, multi-channel routing (WhatsApp, Telegram, Discord, Slack, web), and the ACP bridge for IDE integration.

the relationship between these layers matters: pi-agent-core doesn't know about channels or sessions. the gateway doesn't know about model APIs. each layer has a clean boundary, which is what makes the system flexible enough to serve both a WhatsApp bot and a Zed editor plugin from the same codebase.

```
IDE (Zed, etc) ──ACP──> bridge ──ws──> ┐
                                       │
WhatsApp ──────────────────────────>   │
Telegram ──────────────────────────>   ├── Gateway ── pi-agent-core ── pi-ai ── Model APIs
Discord  ──────────────────────────>   │         │
Slack    ──────────────────────────>   │     sessions
Web UI   ──────────────────────────>   ┘     credentials
                                             routing
```


agent client protocol (ACP)
---

ACP is a standardized wire protocol for IDEs to talk to AI agents. think LSP, but for agent interactions instead of language features. OpenClaw implements both sides.

the transport is NDJSON over stdio. no HTTP server, no port management. an IDE spawns `openclaw acp` as a subprocess and communicates through stdin/stdout. the bridge translates ACP messages into gateway websocket calls.

the protocol surface is small:

- `initialize` - capability handshake (fs access, terminal)
- `newSession` / `loadSession` / `listSessions` - session lifecycle
- `prompt` - send user input (text, resources, images)
- `cancel` - abort a running generation
- `sessionUpdate` - streaming notifications back to the client (text chunks, tool calls, command updates)
- `requestPermission` - agent asks the IDE for permission before acting

each ACP session maps to a gateway session key, so reconnects preserve conversation state. the practical value: any editor that speaks ACP can use OpenClaw as its agent backend without needing a bespoke plugin. Zed works today, and adding another editor requires zero changes on the OpenClaw side.


pi-agent-core internals
---

the agent framework is authored by Mario Zechner (badlogic on GitHub) and lives in the `pi-mono` monorepo. MIT licensed. the three packages OpenClaw depends on:

- `@mariozechner/pi-ai` (model abstraction)
- `@mariozechner/pi-agent-core` (stateful agent loop)
- `@mariozechner/pi-coding-agent` (coding-specific tools and prompts)

the core loop is an `Agent` class you configure with a model, system prompt, and tools. calling `prompt()` kicks off the agentic cycle:

```
prompt("read config.json and summarize it")
│
├─ agent_start
├─ turn_start
│   ├─ user message sent to LLM
│   ├─ LLM streams response (message_update events with text deltas)
│   ├─ LLM requests tool call: read_file({path: "config.json"})
│   ├─ tool_execution_start -> tool runs -> tool_execution_end
│   └─ tool result fed back to LLM
├─ turn_end
│
├─ turn_start (next turn - LLM responds to tool result)
│   ├─ LLM streams final answer
│   └─ no more tool calls
├─ turn_end
└─ agent_end
```

two design decisions worth noting:

**the message pipeline has two stages.** before every LLM call, messages pass through `transformContext()` (prune old messages, inject external context, compact history) and then `convertToLlm()` (filter out app-specific message types the model shouldn't see). this separation is what lets OpenClaw store channel-specific metadata, UI messages, and notification types in the conversation history without confusing the model. the LLM only ever sees clean user/assistant/toolResult messages.

**message queuing supports mid-execution interrupts.** you can inject messages while the agent is running tools. when a queued message is detected after a tool completes, remaining tool calls get skipped and the LLM receives the interruption instead. this matters for interactive use cases where a user changes their mind while a multi-tool operation is in progress.

tools use TypeBox schemas for parameter validation and support streaming progress through an `onUpdate` callback. errors are thrown (not returned as content), caught by the agent, and reported to the LLM as `isError: true` tool results.


authentication architecture
---

this is the part that initially seemed confusing but turns out to be well-structured once you see the two layers.

**layer 1: gateway access.** this controls who can connect to the gateway at all. it's a simple token or password sent over the websocket connection. no OAuth, no complexity. an IDE, a chat client, or any websocket consumer provides credentials when connecting, and the gateway either accepts or rejects. configured via `gateway.auth.token` or `gateway.auth.password`.

**layer 2: model provider auth.** this controls what API keys the agent uses when calling model providers (Anthropic, OpenAI, Bedrock, etc). this is where OAuth lives.

the two layers are fully independent. you can connect to the gateway with a simple bearer token but have your model calls authenticated via Anthropic's OAuth flow. the gateway doesn't care how your model credentials were obtained.

credentials are stored per-agent at `~/.openclaw/agents/<agentId>/auth-profiles.json` and come in three flavors:

- **api_key** - raw API key, user-provided
- **token** - generated via `claude setup-token` or similar
- **oauth** - full OAuth flow with access/refresh tokens and expiry

when an agent needs to call a model, the resolution chain runs through:

1. explicit profile ID (if the request specifies one)
2. configured profile order with round-robin and failure cooldown
3. environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc)
4. config file values
5. AWS credential chain (for Bedrock)

the system also mirrors credentials from external tools. if you've already authenticated Claude Code, OpenClaw can read `~/.claude/.credentials.json` and use those tokens as a fallback. same for Codex, Qwen, and MiniMax CLI credentials. token refresh uses file locking to prevent multiple agents from refreshing simultaneously.

the Anthropic OAuth flow specifically goes through Chutes (`api.chutes.ai`) as the identity provider. it uses PKCE, supports both local browser redirects and manual URL pasting for headless/VPS environments, and stores access + refresh tokens with expiry tracking.

```
login flow:
  openclaw login
  └─> choose provider (anthropic)
      └─> choose auth method (oauth)
          └─> PKCE flow via chutes.ai
              └─> tokens stored in auth-profiles.json

request flow:
  any client ──ws+token──> gateway ──> agent needs claude
      └─> resolveApiKeyForProvider("anthropic")
          └─> finds oauth token from auth-profiles.json
              └─> refreshes if expired (with lockfile)
                  └─> calls anthropic API
```

the practical consequence: you authenticate once with OpenClaw, and any tool that can talk to the gateway gets access to your model providers. the tool doesn't need to manage its own API keys or know anything about OAuth. it just sends prompts and gets responses.


relevance to compass
---

if Compass uses OpenClaw as its AI backend, the integration point would be the gateway websocket. Compass would authenticate to the gateway (layer 1) and send prompts. the gateway handles everything else - model selection, credential resolution, session persistence, streaming.

the ACP protocol is worth watching as a potential standard for AI tool integration, but for a web app like Compass, the websocket API is the more natural fit.

the auth architecture means Compass wouldn't need to store or manage model API keys directly. users would authenticate through OpenClaw's onboarding, and the gateway would resolve credentials at request time. this simplifies the security surface - Compass never touches raw API keys.
