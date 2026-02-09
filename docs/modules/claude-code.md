Claude Code Bridge
===

The Claude Code bridge lets you use your own Anthropic API key to power the Compass agent. Instead of routing through OpenRouter in the cloud, a local daemon runs on your machine, calls the Anthropic API directly, and relays responses back to the Compass UI through a WebSocket connection.

The daemon also gives the agent access to your local filesystem and terminal -- it can read and write files, search directories, and run shell commands. Combined with the Compass tools (query data, manage themes, save memories, etc.), this makes the agent genuinely useful for development work: it can look at your project files, run builds, and interact with Compass data in the same conversation.

The architecture is straightforward: the browser connects to a local WebSocket server (the daemon), which handles inference via the Anthropic API and routes tool calls to either Compass (via REST) or local handlers (filesystem, terminal).

```
Browser (Compass UI)
    │
    │  WebSocket (ws://localhost:18789)
    │
    ▼
compass-bridge daemon (Bun)
    ├── Anthropic API (inference)
    ├── Local tools (fs, terminal)
    └── Compass REST API (data, themes, memories, skills)
```


how it works
---

The bridge has three phases: registration, connection, and inference.

**Registration.** When the daemon starts, it calls `POST /api/bridge/register` on your Compass instance with a Bearer token (the API key you generated in settings). Compass validates the key, looks up the user and their permissions, loads memories, dashboards, and installed skills, and returns the full context plus a list of available tools filtered by the key's scopes.

**Connection.** The browser's `ChatProvider` periodically probes `ws://localhost:18789` to detect whether the daemon is running. When it finds it, and the user has enabled the bridge in settings, the provider creates a `WebSocketChatTransport` that replaces the default HTTP transport. The transport authenticates by sending the API key over the socket and waiting for an `auth_ok` response.

**Inference.** When the user sends a message, the transport sends a `chat.send` message over WebSocket. The daemon acknowledges with a `chat.ack` (including a `runId`), then starts streaming the Anthropic API response. Text chunks are forwarded as `chunk` messages. Tool calls are executed -- either locally (filesystem, terminal) or remotely (Compass API) -- and their results are fed back into the model for the next turn. This loop continues until the model produces a final text response with no tool calls, then a `chat.done` message closes the stream.

The browser receives these chunks through the same `ReadableStream<UIMessageChunk>` interface that the default HTTP transport uses, so the chat UI doesn't know or care whether it's talking to OpenRouter or the local daemon.


setup
---

1. Open Settings in Compass and go to the "Claude Code" tab.

2. Generate an API key. Choose the scopes you want:
   - **read** -- query data, recall memories, list themes/dashboards/skills
   - **write** -- save memories, set themes, CRUD operations (includes read)
   - **admin** -- install/uninstall skills (includes read + write)

   Copy the key immediately. It's shown once and stored only as a SHA-256 hash.

3. Install the bridge daemon:

   ```bash
   npm install -g compass-bridge
   ```

   Or clone the repo and link it:

   ```bash
   cd packages/compass-bridge
   bun install
   bun link
   ```

4. Run the interactive setup:

   ```bash
   compass-bridge init
   ```

   You'll be prompted for:
   - Your Compass URL (e.g., `https://your-compass.example.com`)
   - The API key you just generated (`ck_...`)
   - Your Anthropic API key (`sk-ant-...`)
   - Port (default 18789)

   The config is saved to `~/.compass-bridge/config.json`.

5. Start the daemon:

   ```bash
   compass-bridge start
   ```

6. Back in Compass, the "Claude Code" tab should show a green dot ("Bridge daemon detected"). Flip the switch to enable the bridge.

From this point, all chat messages route through the local daemon instead of OpenRouter.


wire protocol
---

The bridge uses a simple JSON-over-WebSocket protocol. Every message has a `type` field.

**Client to server (browser to daemon):**

| type | purpose |
|------|---------|
| `auth` | authenticate with Compass API key |
| `chat.send` | send a chat message (includes conversation context) |
| `chat.abort` | cancel an in-progress run by `runId` |
| `ping` | heartbeat |

**Server to client (daemon to browser):**

| type | purpose |
|------|---------|
| `auth_ok` | authentication succeeded (includes user info) |
| `auth_error` | authentication failed |
| `chat.ack` | message received, inference starting (includes `runId`) |
| `chunk` | streaming content (text deltas, tool inputs, tool results) |
| `chat.done` | inference complete |
| `chat.error` | inference failed |
| `pong` | heartbeat response |

The `chunk` message wraps `UIMessageChunk` objects from the AI SDK, so the browser's `ReadableStream` can consume them directly. Chunk subtypes include `text-delta` (streaming text), `tool-input-start` (tool call beginning), `tool-input-available` (tool call arguments), and `data-part-available` (tool result).

Types are defined in `src/lib/mcp/types.ts`.


available tools
---

Tools are split into two categories: Compass tools (executed remotely via the Compass REST API) and local tools (executed on the user's machine by the daemon).

**Compass tools** are gated by the API key's scopes:

| tool | scope | what it does |
|------|-------|-------------|
| `queryData` | read | query the database (customers, vendors, projects, invoices, etc.) |
| `recallMemory` | read | search the user's persistent memories |
| `listThemes` | read | list preset and custom visual themes |
| `listDashboards` | read | list saved custom dashboards |
| `listInstalledSkills` | read | list installed agent skills |
| `rememberContext` | write | save something to persistent memory |
| `setTheme` | write | switch the user's visual theme |
| `installSkill` | admin | install a skill from GitHub |
| `uninstallSkill` | admin | remove an installed skill |
| `toggleInstalledSkill` | admin | enable or disable a skill |

Scopes are hierarchical: `write` includes `read`, `admin` includes both.

**Local tools** are always available when the daemon is running:

| tool | what it does |
|------|-------------|
| `readFile` | read a file on the user's machine |
| `writeFile` | write content to a file |
| `listDirectory` | list files and directories |
| `searchFiles` | search for files by glob pattern |
| `runCommand` | execute a shell command (30s timeout, stdout capped at 50KB) |


tool adapter (server side)
---

When Compass receives a tool call via `POST /api/bridge/tools`, the tool adapter (`src/lib/mcp/tool-adapter.ts`) validates the request against the API key's scopes using a hierarchical permission model, then dispatches to the appropriate handler. Each handler is a function that takes `(userId, userRole, args)` and returns the result. Usage is logged to the `mcp_usage` table (fire-and-forget) for auditing.


API key system
---

API keys follow a straightforward design:

- Keys are prefixed with `ck_` and contain 20 random bytes (40 hex chars).
- Only the SHA-256 hash is stored in the database (`mcp_api_keys` table). The raw key is shown once at creation time and never again.
- Keys have scopes (JSON array: `["read", "write", "admin"]`), an optional expiry date, and an `isActive` flag for revocation.
- The `lastUsedAt` timestamp is updated on each validation (best-effort, non-blocking).

Server actions in `src/app/actions/mcp-keys.ts` handle CRUD: `createApiKey`, `listApiKeys`, `revokeApiKey`, `deleteApiKey`. All are authenticated and scoped to the current user.


schema
---

Two tables in `src/db/schema-mcp.ts`:

**`mcp_api_keys`** -- stores API keys for bridge authentication.

| column | type | notes |
|--------|------|-------|
| `id` | text (UUID) | primary key |
| `userId` | text | FK to users, cascade delete |
| `name` | text | human-readable label |
| `keyPrefix` | text | first 8 chars for identification |
| `keyHash` | text | SHA-256 of the full key |
| `scopes` | text | JSON array of scope strings |
| `lastUsedAt` | text | ISO 8601 timestamp |
| `createdAt` | text | ISO 8601 timestamp |
| `expiresAt` | text | optional expiry |
| `isActive` | integer (boolean) | soft revocation |

**`mcp_usage`** -- audit log for tool calls through the bridge.

| column | type | notes |
|--------|------|-------|
| `id` | text (UUID) | primary key |
| `apiKeyId` | text | FK to mcp_api_keys, cascade delete |
| `userId` | text | FK to users, cascade delete |
| `toolName` | text | which tool was called |
| `success` | integer (boolean) | whether the call succeeded |
| `errorMessage` | text | error detail if failed |
| `durationMs` | integer | execution time |
| `createdAt` | text | ISO 8601 timestamp |


security model
---

**API keys are hashed.** Raw keys are never stored. Compromise of the database doesn't leak usable keys.

**Scopes limit blast radius.** A key with `read` scope can't modify data. A key with `write` scope can't install skills. Admin actions also check the user's actual role in Compass.

**Local binding.** The daemon listens on `127.0.0.1` only. It's not reachable from the network.

**Auth on every request.** The WebSocket handshake requires a valid API key. The REST endpoints (`/api/bridge/register`, `/api/bridge/tools`) validate the Bearer token on every call.

**Expiry and revocation.** Keys can have an expiry date and can be revoked (soft-disabled) from the settings UI without deletion. Revoked keys fail validation immediately.

**Usage auditing.** Every tool call through the bridge is logged with the key ID, user ID, tool name, success/failure, and duration.


the daemon
---

The daemon is a standalone Bun process in `packages/compass-bridge/`. It has no dependency on the Compass web app at runtime -- it communicates purely via HTTP and WebSocket.

Key files:

```
packages/compass-bridge/src/
  index.ts        # CLI entry (init, start, status, help)
  config.ts       # config read/write (~/.compass-bridge/config.json)
  auth.ts         # registration + context refresh via Compass API
  server.ts       # Bun.serve WebSocket server
  inference.ts    # Anthropic API client + agentic tool loop
  prompt.ts       # system prompt builder (identity, tools, memories)
  session.ts      # in-memory conversation history (100 message cap)
  tools/
    registry.ts   # tool routing (local vs compass)
    compass.ts    # remote tool execution via Compass REST
    filesystem.ts # readFile, writeFile, listDirectory, searchFiles
    terminal.ts   # runCommand (30s timeout, output caps)
```

The inference loop (`inference.ts`) is a standard agentic pattern: call the Anthropic API with tools, stream the response, collect tool calls, execute them, feed results back, repeat until the model stops calling tools. It uses `claude-sonnet-4-5-20250929` with an 8192 token max.

Sessions are stored in memory (not persisted). The daemon holds the last 100 messages per conversation to keep context manageable.


UI integration
---

On the Compass side, the bridge integrates at two points:

**ChatProvider** (`src/components/agent/chat-provider.tsx`) manages bridge state through a `BridgeContext`. It polls for the daemon every 30 seconds when enabled, creates a `WebSocketChatTransport` when connected, and passes it to `useCompassChat()`. The hook uses the bridge transport when available, falling back to the default HTTP transport otherwise.

**Settings UI** (`src/components/settings/claude-code-tab.tsx`) provides the "Claude Code" tab where users generate API keys, see the daemon connection status, toggle the bridge on/off, and view setup instructions.


troubleshooting
---

**"Bridge daemon not running" in settings.** Make sure `compass-bridge start` is running in a terminal. Check that the port (default 18789) isn't blocked or in use. Run `compass-bridge status` to verify.

**"bridge auth timeout" in the chat.** The API key in the browser's localStorage doesn't match the one in the daemon's config. Re-run `compass-bridge init` with the correct key, or generate a new one in settings.

**Tool calls failing with "insufficient scope".** The API key doesn't have the required scope for that tool. Generate a new key with the needed scopes (read/write/admin).

**"Registration failed" on daemon start.** The Compass URL or API key is wrong. Check `~/.compass-bridge/config.json`. Make sure the Compass instance is reachable from your machine.

**Commands timing out.** The `runCommand` tool has a 30-second timeout. For long-running commands, break them into smaller steps or increase the timeout in the daemon source.

**No tool results appearing in chat.** The chunk messages might not be mapping correctly to the AI SDK's `UIMessageChunk` format. Check the browser console for WebSocket errors. The daemon logs tool execution to stdout.
