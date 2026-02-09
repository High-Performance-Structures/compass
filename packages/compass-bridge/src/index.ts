#!/usr/bin/env bun

// compass-bridge CLI entry point

import {
  loadConfig,
  saveConfig,
  isConfigured,
  hasAnthropicKey,
  loadClaudeCredentials,
  CONFIG_PATH,
  type BridgeConfig,
} from "./config"
import { registerWithCompass } from "./auth"
import { startServer } from "./server"
import { login as oauthLogin } from "./oauth"
import { startProxy, PROXY_PORT } from "./proxy"

const args = process.argv.slice(2)
const command = args[0] ?? "help"
const flags = new Set(args.slice(1))

async function promptInput(
  question: string,
): Promise<string> {
  process.stdout.write(question)
  for await (const line of console) {
    return line.trim()
  }
  return ""
}

async function promptYesNo(
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N"
  const answer = await promptInput(
    `${question} (${hint}): `,
  )
  if (answer === "") return defaultYes
  return answer.toLowerCase().startsWith("y")
}

async function init(): Promise<void> {
  console.log("compass-bridge setup\n")

  const existing = await loadConfig()

  const compassUrl = await promptInput(
    `Compass URL [${existing.compassUrl || "https://your-compass.example.com"}]: `,
  )
  const apiKey = await promptInput(
    "Compass API key (ck_...): ",
  )
  const portStr = await promptInput(
    `Port [${existing.port || 18789}]: `,
  )

  const config: BridgeConfig = {
    compassUrl:
      compassUrl || existing.compassUrl || "",
    apiKey: apiKey || existing.apiKey || "",
    anthropicApiKey: existing.anthropicApiKey,
    oauthCredentials: existing.oauthCredentials,
    port: portStr
      ? parseInt(portStr, 10)
      : existing.port || 18789,
    allowedOrigins: existing.allowedOrigins,
  }

  await saveConfig(config)
  console.log(`\nConfig saved to ${CONFIG_PATH}`)

  // verify compass connection
  if (isConfigured(config)) {
    console.log("\nVerifying connection...")
    try {
      const result =
        await registerWithCompass(config)
      console.log(
        `Connected as ${result.user.name} (${result.user.role})`,
      )
      console.log(
        `${result.tools.length} tools available`,
      )
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "unknown error"
      console.error(`Connection failed: ${msg}`)
      console.error(
        "Check your Compass URL and API key.",
      )
    }
  }

  // anthropic auth
  if (config.oauthCredentials) {
    console.log(
      "\nAnthropic: authenticated via OAuth",
    )
  } else if (config.anthropicApiKey) {
    const kind = config.anthropicApiKey.startsWith(
      "sk-ant-oat",
    )
      ? "setup-token"
      : "API key"
    console.log(`\nAnthropic: ${kind} configured`)
  } else if (!hasAnthropicKey(config)) {
    console.log("")
    const wantsAuth = await promptYesNo(
      "Authenticate with Anthropic now?",
    )

    if (wantsAuth) {
      await runLogin(config)
    } else {
      console.log(
        "\nYou can authenticate later with " +
          "'compass-bridge login'\n" +
          "or set the ANTHROPIC_API_KEY env var.",
      )
    }
  } else {
    console.log(
      "\nAnthropic: env var configured",
    )
  }

  console.log(
    "\nRun 'compass-bridge start' to launch the daemon.",
  )
}

async function runLogin(
  existingConfig?: BridgeConfig,
): Promise<void> {
  const config =
    existingConfig ?? (await loadConfig())

  console.log("\nAuthenticate with Anthropic:\n")
  console.log(
    "  1. OAuth (browser login)" +
      " - opens anthropic.com in your browser",
  )
  console.log(
    "  2. Setup token" +
      " - run 'claude setup-token' and paste",
  )
  console.log(
    "  3. API key" +
      " - paste key from console.anthropic.com",
  )

  const choice = await promptInput("\nChoice [1]: ")
  const method = choice === "2"
    ? "token"
    : choice === "3"
      ? "apikey"
      : "oauth"

  if (method === "oauth") {
    try {
      const result = await oauthLogin({
        manual: flags.has("--manual"),
      })

      const updated: BridgeConfig = {
        ...config,
        oauthCredentials: result,
        // ensure OAuth takes effect by clearing stale keys
        anthropicApiKey: undefined,
      }
      await saveConfig(updated)

      console.log("\nauthenticated with Anthropic.")
      console.log(
        `token: ${result.access.slice(0, 15)}...`,
      )
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "unknown error"
      console.error(`\nOAuth login failed: ${msg}`)
      console.error(
        "try again with --manual, or use option " +
          "2 (setup-token) or 3 (API key).",
      )
    }
    return
  }

  if (method === "token") {
    console.log(
      "\nrun 'claude setup-token' in your " +
        "terminal, then paste below.",
    )
  } else {
    console.log(
      "\npaste your API key from " +
        "console.anthropic.com/settings/keys",
    )
  }

  const key = await promptInput(
    "\ntoken (sk-ant-...): ",
  )

  if (!key || !key.startsWith("sk-ant-")) {
    console.error(
      "invalid token. expected format: sk-ant-...",
    )
    return
  }

  const updated: BridgeConfig = {
    ...config,
    anthropicApiKey: key,
    // clear stale oauth credentials
    oauthCredentials: undefined,
  }
  await saveConfig(updated)

  const kind = key.startsWith("sk-ant-oat")
    ? "setup-token"
    : "API key"
  console.log(
    `\n${kind} saved: ${key.slice(0, 15)}...`,
  )
}


async function start(): Promise<void> {
  const config = await loadConfig()

  if (!isConfigured(config)) {
    console.error(
      "Not configured. " +
        "Run 'compass-bridge init' first.",
    )
    process.exit(1)
  }

  if (!hasAnthropicKey(config)) {
    console.error(
      "No Anthropic API key. " +
        "Run 'compass-bridge login' " +
        "or set ANTHROPIC_API_KEY env var.",
    )
    process.exit(1)
  }

  if (flags.has("--proxy")) {
    const portEnv = process.env.COMPASS_BRIDGE_PROXY_PORT
    const port = portEnv
      ? parseInt(portEnv, 10)
      : PROXY_PORT
    const baseUrlEnv =
      process.env.COMPASS_BRIDGE_ANTHROPIC_BASE_URL
    if (!baseUrlEnv) {
      process.env.COMPASS_BRIDGE_ANTHROPIC_BASE_URL =
        `http://127.0.0.1:${port}`
    }
    startProxy(port)
    console.log(
      `[bridge] proxy enabled for start (port ${port})`,
    )
  }

  console.log("[bridge] registering with Compass...")

  try {
    const registration =
      await registerWithCompass(config)
    startServer(config, registration)
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "unknown error"
    console.error(
      `[bridge] failed to start: ${msg}`,
    )
    process.exit(1)
  }
}

async function status(): Promise<void> {
  const config = await loadConfig()

  if (!isConfigured(config)) {
    console.log("Status: not configured")
    console.log(
      "Run 'compass-bridge init' to set up.",
    )
    return
  }

  console.log(`Compass URL: ${config.compassUrl}`)
  console.log(`Port: ${config.port}`)
  console.log(
    `API key: ${config.apiKey.slice(0, 11)}...`,
  )
  const envKey = process.env.ANTHROPIC_API_KEY
  const creds = loadClaudeCredentials()
  if (envKey) {
    console.log(
      "Anthropic key: env var (ANTHROPIC_API_KEY)",
    )
    if (config.oauthCredentials) {
      console.log(
        "  note: OAuth credentials present but env var takes precedence",
      )
    }
    if (config.anthropicApiKey) {
      console.log(
        "  note: bridge config key present but env var takes precedence",
      )
    }
  } else if (config.anthropicApiKey) {
    console.log("Anthropic key: bridge config")
    if (config.oauthCredentials) {
      console.log(
        "  note: OAuth credentials present but bridge config takes precedence",
      )
    }
  } else if (config.oauthCredentials) {
    const expired =
      Date.now() > config.oauthCredentials.expires
    console.log(
      `Anthropic key: OAuth credentials` +
        (expired
          ? " (token expired, will refresh)"
          : ""),
    )
  } else if (creds) {
    const expired = Date.now() > creds.expiresAt
    console.log(
      `Anthropic key: Claude Code credentials` +
        (expired
          ? " (token expired, will refresh)"
          : ""),
    )
  } else {
    console.log("Anthropic key: not set")
  }

  // check if daemon is running
  try {
    const res = await fetch(
      `http://127.0.0.1:${config.port}/health`,
    )
    if (res.ok) {
      console.log("Daemon: running")
    } else {
      console.log("Daemon: not running")
    }
  } catch {
    console.log("Daemon: not running")
  }
}

async function proxy(): Promise<void> {
  const portEnv = process.env.COMPASS_BRIDGE_PROXY_PORT
  const port = portEnv
    ? parseInt(portEnv, 10)
    : PROXY_PORT
  startProxy(port)
}

switch (command) {
  case "init":
    await init()
    break
  case "login":
    await runLogin()
    break
  case "start":
    await start()
    break
  case "status":
    await status()
    break
  case "proxy":
    await proxy()
    break
  case "help":
  default:
    console.log(`compass-bridge - local daemon for Claude Code + Compass

Usage:
  compass-bridge init      Configure Compass URL and API keys
  compass-bridge login     Authenticate with Anthropic (OAuth, setup-token, or API key)
  compass-bridge start     Start the bridge daemon
  compass-bridge status    Check daemon status
  compass-bridge proxy     Start the Claude Code auth proxy
  compass-bridge help      Show this help message

Options:
  --manual    Use manual OAuth flow (for headless environments)
  --proxy     Start Claude Code proxy with the daemon
`)
    break
}
