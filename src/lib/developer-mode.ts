export const DEVELOPER_MODE_COOKIE = "compass-developer-mode"

export function developerModeFromCookie(
  value: string | undefined,
  canUseDeveloperMode: boolean,
): boolean {
  return canUseDeveloperMode && value === "enabled"
}
