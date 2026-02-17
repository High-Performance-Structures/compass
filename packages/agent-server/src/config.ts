/**
 * Configuration for agent server
 * Reads from environment variables
 */

export interface Config {
  anthropicApiKey: string | undefined
  anthropicBaseUrl: string | undefined
  compassApiBaseUrl: string
  agentAuthSecret: string
  allowedOrigins: string[]
  port: number
}

function parseOrigins(originsStr: string | undefined): string[] {
  if (!originsStr) {
    return ["http://localhost:3000"]
  }
  return originsStr.split(",").map(o => o.trim())
}

export function loadConfig(): Config {
  const agentAuthSecret = process.env.AGENT_AUTH_SECRET
  if (!agentAuthSecret) {
    throw new Error("AGENT_AUTH_SECRET environment variable is required")
  }

  const compassApiBaseUrl = process.env.COMPASS_API_BASE_URL
  if (!compassApiBaseUrl) {
    throw new Error("COMPASS_API_BASE_URL environment variable is required")
  }

  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
    compassApiBaseUrl,
    agentAuthSecret,
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
    port: parseInt(process.env.PORT || "3001", 10),
  }
}

export const config = loadConfig()
