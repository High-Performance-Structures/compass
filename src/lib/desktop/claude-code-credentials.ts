// Claude Code credential detection for Tauri desktop app.
// Reads OAuth tokens from ~/.claude/.credentials.json for auto-configuration.

export interface ClaudeOAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in seconds
  subscriptionType?: string
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    subscriptionType?: string
  }
}

// Check if credentials are expired or expiring within 5 minutes
export function areCredentialsExpired(
  creds: ClaudeOAuthCredentials
): boolean {
  const bufferMs = 5 * 60 * 1000 // 5 minutes
  return Date.now() > creds.expiresAt * 1000 - bufferMs
}

// Read credentials via Tauri fs plugin (desktop only)
// Returns null if not on desktop, file doesn't exist, or on any error
export async function detectClaudeCodeCredentials(): Promise<ClaudeOAuthCredentials | null> {
  // Dynamic import gated behind platform check
  if (typeof window === "undefined") return null

  // Check if we're in Tauri by looking for __TAURI__ global
  const tauriGlobal = (
    window as unknown as Record<string, unknown>
  ).__TAURI__
  if (!tauriGlobal) return null

  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs")
    const { homeDir } = await import("@tauri-apps/api/path")

    const home = await homeDir()
    const credentialsPath = `${home}.claude/.credentials.json`

    const content = await readTextFile(credentialsPath)
    const data = JSON.parse(content) as ClaudeCredentialsFile

    if (!data.claudeAiOauth) return null

    const oauth = data.claudeAiOauth
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: oauth.subscriptionType,
    }
  } catch {
    // File doesn't exist or parse error — credentials not available
    return null
  }
}

// Local storage key for "don't ask again" preference
const DONT_ASK_KEY = "compass:claude-code-credentials-dismissed"

export function setCredentialsDismissed(): void {
  localStorage.setItem(DONT_ASK_KEY, "true")
}

export function isCredentialsDismissed(): boolean {
  return localStorage.getItem(DONT_ASK_KEY) === "true"
}

export function clearCredentialsDismissed(): void {
  localStorage.removeItem(DONT_ASK_KEY)
}
