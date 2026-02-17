// Anthropic OAuth constants (same as Claude Code / pi-ai)
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
const SCOPES = "org:create_api_key user:profile user:inference"

interface OAuthTokenResponse {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_in: number
  readonly token_type: string
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export async function generatePKCE(): Promise<{
  verifier: string
  challenge: string
}> {
  // 32 random bytes -> 43 base64url chars, well within 43-128 range
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64url(verifierBytes.buffer)

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64url(hash)

  return { verifier, challenge }
}

export function buildAuthUrl(challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

function parseTokenResponse(raw: unknown): {
  access: string
  refresh: string
  expiresAt: number
} {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("access_token" in raw) ||
    !("refresh_token" in raw) ||
    !("expires_in" in raw)
  ) {
    throw new Error("Unexpected token response shape")
  }

  const resp = raw as OAuthTokenResponse
  return {
    access: resp.access_token,
    refresh: resp.refresh_token,
    expiresAt: Date.now() + resp.expires_in * 1000,
  }
}

async function postToken(body: Record<string, string>): Promise<{
  access: string
  refresh: string
  expiresAt: number
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token request failed (${res.status}): ${text}`)
  }

  const json: unknown = await res.json()
  return parseTokenResponse(json)
}

export async function exchangeCode(
  code: string,
  state: string,
  verifier: string,
): Promise<{ access: string; refresh: string; expiresAt: number }> {
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    state,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access: string; refresh: string; expiresAt: number }> {
  return postToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  })
}
