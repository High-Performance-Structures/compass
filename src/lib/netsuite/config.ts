import { envValue } from "@/lib/shared/env"

export interface NetSuiteConfig {
  accountId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  tokenEncryptionKey: string
  concurrencyLimit: number
}

export function getNetSuiteConfig(
  env: unknown
): NetSuiteConfig {
  const accountId = envValue(env, "NETSUITE_ACCOUNT_ID")
  const clientId = envValue(env, "NETSUITE_CLIENT_ID")
  const clientSecret = envValue(env, "NETSUITE_CLIENT_SECRET")
  const redirectUri = envValue(env, "NETSUITE_REDIRECT_URI")
  const tokenEncryptionKey = envValue(env, "NETSUITE_TOKEN_ENCRYPTION_KEY")
  const concurrencyLimit = parseInt(
    envValue(env, "NETSUITE_CONCURRENCY_LIMIT") ?? "15",
    10
  )

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Missing required NetSuite configuration")
  }
  if (!redirectUri) {
    throw new Error("NETSUITE_REDIRECT_URI is required")
  }
  if (!tokenEncryptionKey) {
    throw new Error("NETSUITE_TOKEN_ENCRYPTION_KEY is required")
  }

  return {
    accountId,
    clientId,
    clientSecret,
    redirectUri,
    tokenEncryptionKey,
    concurrencyLimit,
  }
}

// netsuite uses different URL formats for REST vs auth,
// and sandbox has inconsistent casing/separators
export function getRestBaseUrl(accountId: string): string {
  const urlId = accountId.toLowerCase().replace("_", "-")
  return `https://${urlId}.suitetalk.api.netsuite.com`
}

export function getAuthBaseUrl(accountId: string): string {
  const urlId = accountId.toLowerCase().replace("_", "-")
  return `https://${urlId}.app.netsuite.com`
}

export function getSuiteQLUrl(accountId: string): string {
  return `${getRestBaseUrl(accountId)}/services/rest/query/v1/suiteql`
}

export function getRecordUrl(
  accountId: string,
  recordType: string,
  id?: string
): string {
  const base = `${getRestBaseUrl(accountId)}/services/rest/record/v1/${recordType}`
  return id ? `${base}/${id}` : base
}
