import { getAuthBaseUrl, type NetSuiteConfig } from "../config"

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
  issuedAt: number
}

const SCOPES = ["rest_webservices", "suite_analytics"]

export function getAuthorizeUrl(
  config: NetSuiteConfig,
  state: string
): string {
  const base = getAuthBaseUrl(config.accountId)
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES.join(" "),
    state,
  })

  return `${base}/app/login/oauth2/authorize.nl?${params.toString()}`
}

export async function exchangeCodeForTokens(
  config: NetSuiteConfig,
  code: string
): Promise<OAuthTokens> {
  const base = getAuthBaseUrl(config.accountId)
  const tokenUrl = `${base}/app/login/oauth2/token.nl`

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  })

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(config.clientId, config.clientSecret),
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Token exchange failed (${response.status}): ${text}`
    )
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    issuedAt: Date.now(),
  }
}

export async function refreshAccessToken(
  config: NetSuiteConfig,
  refreshToken: string
): Promise<OAuthTokens> {
  const base = getAuthBaseUrl(config.accountId)
  const tokenUrl = `${base}/app/login/oauth2/token.nl`

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(config.clientId, config.clientSecret),
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Token refresh failed (${response.status}): ${text}`
    )
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    issuedAt: Date.now(),
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}
