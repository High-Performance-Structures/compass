export function isLocalAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false
  }

  return process.env.BYPASS_WORKOS_AUTH !== "false"
}
