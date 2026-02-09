import { existsSync } from "fs"
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
} from "fs/promises"
import { homedir } from "os"
import { join } from "path"
import { refreshAnthropicToken } from "@mariozechner/pi-ai"

const CONFIG_DIR = join(homedir(), ".compass-bridge")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")
const DEBUG_AUTH =
  process.env.COMPASS_BRIDGE_DEBUG_AUTH === "1"

export interface OAuthCredentials {
  readonly access: string
  readonly refresh: string
  readonly expires: number
}

export interface BridgeConfig {
  readonly compassUrl: string
  readonly apiKey: string
  readonly anthropicApiKey?: string
  readonly oauthCredentials?: OAuthCredentials
  readonly port: number
  readonly allowedOrigins: ReadonlyArray<string>
}

const DEFAULT_CONFIG: BridgeConfig = {
  compassUrl: "",
  apiKey: "",
  port: 18789,
  allowedOrigins: [],
}

export async function loadConfig(): Promise<BridgeConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG
  }

  const raw = await readFile(CONFIG_PATH, "utf-8")
  const parsed = JSON.parse(raw) as Partial<BridgeConfig>

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
  }
}

export async function saveConfig(
  config: BridgeConfig,
): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await chmod(CONFIG_DIR, 0o700)
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8",
  )
  await chmod(CONFIG_PATH, 0o600)
}

export function isConfigured(
  config: BridgeConfig,
): boolean {
  return (
    config.compassUrl.length > 0 &&
    config.apiKey.length > 0
  )
}

// -- Claude Code credential discovery --

const CLAUDE_CREDENTIALS_PATH = join(
  homedir(),
  ".claude",
  ".credentials.json",
)

interface ClaudeOAuthCredentials {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly subscriptionType?: string
}

interface ClaudeCredentialsFile {
  readonly claudeAiOauth?: ClaudeOAuthCredentials
}

export function loadClaudeCredentials():
  ClaudeOAuthCredentials | undefined {
  if (!existsSync(CLAUDE_CREDENTIALS_PATH)) {
    return undefined
  }
  try {
    const raw = require("fs").readFileSync(
      CLAUDE_CREDENTIALS_PATH,
      "utf-8",
    )
    const parsed =
      JSON.parse(raw) as ClaudeCredentialsFile
    return parsed.claudeAiOauth
  } catch {
    return undefined
  }
}

export async function refreshClaudeToken(
  refreshToken: string,
): Promise<ClaudeOAuthCredentials | undefined> {
  try {
    const res = await fetch(
      "https://console.anthropic.com/v1/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      },
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  } catch {
    return undefined
  }
}

export async function refreshOAuthToken(
  refreshToken: string,
): Promise<OAuthCredentials | undefined> {
  try {
    const result =
      await refreshAnthropicToken(refreshToken)
    return {
      access: result.access,
      refresh: result.refresh,
      expires: result.expires,
    }
  } catch {
    return undefined
  }
}

// -- anthropic auth resolution --
// priority: env var > config file > bridge oauth

export type AnthropicAuth =
  | { readonly type: "apiKey"; readonly key: string }
  | {
      readonly type: "oauthToken"
      readonly token: string
    }

export function hasAnthropicKey(
  config: BridgeConfig,
): boolean {
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey && envKey.length > 0) return true
  const configKey = config.anthropicApiKey
  if (configKey && configKey.length > 0) return true
  if (config.oauthCredentials?.access) return true
  return false
}

// setup-tokens (sk-ant-oat01-) need Bearer auth,
// API keys (sk-ant-api...) need x-api-key header
function resolveKeyType(key: string): AnthropicAuth {
  if (key.startsWith("sk-ant-oat")) {
    return { type: "oauthToken", token: key }
  }
  return { type: "apiKey", key }
}

function describeToken(token: string): string {
  if (token.startsWith("sk-ant-oat")) return "setup-token"
  if (token.startsWith("sk-ant-api")) return "api-key"
  if (token.startsWith("sk-ant-")) return "sk-ant"
  if (token.startsWith("cc_") || token.startsWith("claude")) {
    return "claude-code"
  }
  return "unknown"
}

function logAuth(source: string, auth: AnthropicAuth): void {
  if (!DEBUG_AUTH) return
  if (auth.type === "apiKey") {
    console.log(
      `[bridge] anthropic auth: ${source} (apiKey, ${describeToken(auth.key)})`,
    )
    return
  }
  console.log(
    `[bridge] anthropic auth: ${source} (oauth, ${describeToken(auth.token)})`,
  )
}

export async function getAnthropicAuth(
  config: BridgeConfig,
): Promise<AnthropicAuth | undefined> {
  // 1. env var (highest priority)
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey && envKey.length > 0) {
    const resolved = resolveKeyType(envKey)
    logAuth("env", resolved)
    return resolved
  }

  // 2. explicit key in bridge config
  const configKey = config.anthropicApiKey
  if (configKey && configKey.length > 0) {
    const resolved = resolveKeyType(configKey)
    logAuth("config", resolved)
    return resolved
  }

  // 3. bridge OAuth credentials
  if (config.oauthCredentials) {
    const oauth = config.oauthCredentials
    const isExpired =
      Date.now() > oauth.expires - 5 * 60 * 1000

    if (!isExpired) {
      const auth: AnthropicAuth = {
        type: "oauthToken",
        token: oauth.access,
      }
      logAuth("oauth", auth)
      return auth
    }

    // try to refresh
    console.log(
      "[bridge] OAuth token expired, refreshing...",
    )
    const refreshed = await refreshOAuthToken(
      oauth.refresh,
    )
    if (refreshed) {
      // update config with new tokens
      const updated: BridgeConfig = {
        ...config,
        oauthCredentials: refreshed,
      }
      await saveConfig(updated)
      const auth: AnthropicAuth = {
        type: "oauthToken",
        token: refreshed.access,
      }
      logAuth("oauth-refresh", auth)
      return auth
    }
    console.warn(
      "[bridge] OAuth token refresh failed. " +
        "Run 'compass-bridge login' to " +
        "re-authenticate.",
    )
  }

  // Claude Code credentials (~/.claude/.credentials.json)
  // are NOT usable here -- those tokens are restricted
  // to Claude Code only and will return 400 from bridge.
  return undefined
}

export { CONFIG_DIR, CONFIG_PATH, CLAUDE_CREDENTIALS_PATH }
