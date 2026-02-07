// JWT-based auth for google service accounts with
// domain-wide delegation (impersonating workspace users).
// uses Web Crypto API for RS256 signing (cloudflare workers compatible).

import {
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_TOKEN_URL,
  type ServiceAccountKey,
} from "../config"

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str))
}

// convert PEM private key to CryptoKey for RS256 signing
async function importPrivateKey(
  pem: string
): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "")

  const binaryString = atob(pemBody)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  )
}

export async function createServiceAccountJWT(
  serviceAccountKey: ServiceAccountKey,
  userEmail: string,
  scopes: ReadonlyArray<string> = GOOGLE_DRIVE_SCOPES
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: serviceAccountKey.private_key_id,
  }

  const payload = {
    iss: serviceAccountKey.client_email,
    sub: userEmail,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }

  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await importPrivateKey(
    serviceAccountKey.private_key
  )
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  )

  const signatureB64 = base64url(new Uint8Array(signature))

  return `${signingInput}.${signatureB64}`
}

export type AccessTokenResponse = {
  readonly access_token: string
  readonly token_type: string
  readonly expires_in: number
}

export async function exchangeJWTForAccessToken(
  jwt: string
): Promise<AccessTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Token exchange failed (${response.status}): ${body}`
    )
  }

  return response.json() as Promise<AccessTokenResponse>
}

export async function getAccessToken(
  serviceAccountKey: ServiceAccountKey,
  userEmail: string
): Promise<string> {
  const jwt = await createServiceAccountJWT(
    serviceAccountKey,
    userEmail
  )
  const tokenResponse = await exchangeJWTForAccessToken(jwt)
  return tokenResponse.access_token
}
