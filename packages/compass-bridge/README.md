compass-bridge
===

Local daemon that connects your Compass instance to the Anthropic API. Instead of routing through OpenRouter, you use your own API key for inference, and the daemon gives the agent access to your local filesystem and terminal alongside Compass data.


quick start
---

```bash
# install globally
npm install -g compass-bridge

# or from the repo
cd packages/compass-bridge && bun install && bun link

# interactive setup
compass-bridge init

# start the daemon
compass-bridge start
```

During `init`, you'll need:
- Your Compass instance URL
- A Compass API key (generate one in Settings > Claude Code)
- An Anthropic API key


commands
---

```
compass-bridge init      Interactive setup (Compass URL, API keys, port)
compass-bridge start     Start the WebSocket daemon
compass-bridge status    Check config and daemon health
compass-bridge help      Show usage
```


how it works
---

1. On startup, the daemon registers with Compass via `POST /api/bridge/register`. This validates the API key and returns the user context, available tools, memories, dashboards, and installed skills.

2. The daemon starts a WebSocket server on `127.0.0.1:18789` (configurable). Only local connections are accepted.

3. The Compass browser UI detects the daemon and routes chat messages through the WebSocket instead of the usual HTTP API.

4. When the user sends a message, the daemon calls the Anthropic API (`claude-sonnet-4-5-20250929`) with the full tool set:
   - **Compass tools** (remote): queryData, recallMemory, rememberContext, listThemes, setTheme, listDashboards, listInstalledSkills, installSkill, uninstallSkill, toggleInstalledSkill
   - **Local tools**: readFile, writeFile, listDirectory, searchFiles, runCommand

5. Tool calls are routed automatically: Compass tools go back to the Compass REST API, local tools execute directly on your machine.

6. Streaming text and tool results are relayed to the browser as WebSocket chunks.


configuration
---

Config lives at `~/.compass-bridge/config.json`:

```json
{
  "compassUrl": "https://your-compass.example.com",
  "apiKey": "ck_...",
  "anthropicApiKey": "sk-ant-...",
  "port": 18789,
  "allowedOrigins": []
}
```

| field | description | default |
|-------|-------------|---------|
| `compassUrl` | your Compass instance URL | (required) |
| `apiKey` | Compass bridge API key | (required) |
| `anthropicApiKey` | your Anthropic API key | (required) |
| `port` | WebSocket server port | 18789 |
| `allowedOrigins` | CORS origins (unused currently) | [] |


local tools
---

The daemon provides five tools that run directly on your machine:

**readFile** -- Read file contents. Takes an absolute or relative path.

**writeFile** -- Write content to a file. Creates the file if it doesn't exist.

**listDirectory** -- List files and directories at a path. Returns name and type (file/directory) for each entry.

**searchFiles** -- Glob search. Takes a root directory, a pattern (e.g., `**/*.ts`), and an optional max results (default 50).

**runCommand** -- Execute a shell command via `sh -c`. 30-second timeout. Stdout is capped at 50KB, stderr at 10KB.


requirements
---

- [Bun](https://bun.sh) (runtime)
- A Compass instance with the bridge API enabled
- An Anthropic API key


project structure
---

```
src/
  index.ts        # CLI entry point
  config.ts       # config read/write
  auth.ts         # Compass registration + context refresh
  server.ts       # Bun.serve WebSocket server
  inference.ts    # Anthropic API streaming + tool loop
  prompt.ts       # system prompt builder
  session.ts      # in-memory conversation history
  tools/
    registry.ts   # tool routing (local vs compass)
    compass.ts    # remote tool calls to Compass API
    filesystem.ts # file read/write/list/search
    terminal.ts   # shell command execution
```


development
---

```bash
# run directly (no build needed with bun)
bun run src/index.ts start

# build a standalone binary
bun run build
```
