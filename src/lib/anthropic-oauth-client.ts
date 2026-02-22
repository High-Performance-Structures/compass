// Browser-safe PKCE + auth URL generation for Anthropic OAuth.
// Duplicated from agent-core/oauth.ts to avoid pulling in
// server-only MCP deps via the barrel export.

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback"
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code"

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

export async function generatePKCE(): Promise<{
  verifier: string
  challenge: string
  state: string
}> {
  const verifierBytes = crypto.getRandomValues(
    new Uint8Array(32)
  )
  const verifier = base64url(verifierBytes.buffer)

  // Generate random state for CSRF protection
  const stateBytes = crypto.getRandomValues(new Uint8Array(16))
  const state = base64url(stateBytes.buffer)

  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(verifier)
  )
  const challenge = base64url(hash)

  return { verifier, challenge, state }
}

export function buildAuthUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}
