// Claude Code credential detection for Electron desktop app.
// The renderer only receives presence/expiry metadata; tokens stay in the
// Electron main process.

export interface ClaudeCredentialsStatus {
  hasCredentials: boolean
  expiresAt: number // Unix timestamp in seconds
  subscriptionType?: string
}

// Check if credentials are expired or expiring within 5 minutes
export function areCredentialsExpired(
  creds: ClaudeCredentialsStatus
): boolean {
  const bufferMs = 5 * 60 * 1000 // 5 minutes
  return Date.now() > creds.expiresAt * 1000 - bufferMs
}

// Read credentials via Electron main process (desktop only)
// Returns null if not on desktop, file doesn't exist, or on any error
export async function detectClaudeCodeCredentials(): Promise<ClaudeCredentialsStatus | null> {
  if (typeof window === "undefined") return null

  const desktop = window.compassDesktop
  if (!desktop) return null

  try {
    return await desktop.fs.detectClaudeCodeCredentials()
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
