export const LOGOUT_PENDING_KEY = "compass_field_logout_pending_v1"

export function logoutBlockedReason(queuedItems: number, busy: boolean, offlineAndroid = false): string | null {
  if (queuedItems > 0) return "Sync all waiting work before logging out. Your saved work will stay on this device until it syncs."
  if (busy) return "Wait for the current download or sync to finish before logging out."
  if (offlineAndroid) return "Connect to the internet before logging out so Compass can stop notifications for this account."
  return null
}

export function accountPreferenceKeys(keys: readonly string[]): readonly string[] {
  return keys.filter((key) =>
    (key.startsWith("compass_field_") && key !== "compass_field_theme_v1" && key !== LOGOUT_PENDING_KEY)
    || key.startsWith("compass_native_auth_")
    || key === "compass_biometric_enabled"
  )
}

type LogoutDependencies = {
  readonly stopNotifications: () => Promise<void>
  readonly clearCookies: () => Promise<void>
  readonly clearFiles: () => Promise<void>
  readonly keys: () => Promise<{ readonly keys: readonly string[] }>
  readonly remove: (options: { readonly key: string }) => Promise<void>
}

/** Runs on a fresh launch, before loading account data or starting requests.
 * Keeping the marker until the last step makes interrupted cleanup retryable.
 */
export async function completeFieldLogout(dependencies: LogoutDependencies): Promise<
  { readonly success: true } | { readonly success: false; readonly error: string }
> {
  try {
    await dependencies.stopNotifications()
    await dependencies.clearCookies()
    await dependencies.clearFiles()
    const { keys } = await dependencies.keys()
    for (const key of accountPreferenceKeys(keys)) await dependencies.remove({ key })
    await dependencies.remove({ key: LOGOUT_PENDING_KEY })
    return { success: true }
  } catch {
    return { success: false, error: "Compass could not finish logging out. Retry to safely clear this account from the device." }
  }
}
