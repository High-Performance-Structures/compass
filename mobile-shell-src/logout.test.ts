import { describe, expect, it, vi } from "vitest"
import { accountPreferenceKeys, completeFieldLogout, LOGOUT_PENDING_KEY, logoutBlockedReason } from "./logout"

describe("Field Mode logout", () => {
  it("blocks waiting work and active transfers before account switching", () => {
    expect(logoutBlockedReason(1, false)).toContain("Sync all waiting work")
    expect(logoutBlockedReason(0, true)).toContain("finish")
    expect(logoutBlockedReason(0, false)).toBeNull()
    expect(logoutBlockedReason(0, false, true)).toContain("Connect to the internet")
  })

  it("removes account data across every cached project while keeping device appearance", () => {
    const keys = ["compass_field_profile_v1", "compass_field_packet_v1.old-project", "compass_field_log_draft_v1.old-project", "compass_field_machine_draft_v1", "compass_native_auth_verifier_v1", "compass_biometric_enabled", "compass_field_theme_v1", LOGOUT_PENDING_KEY, "unrelated-preference"]
    expect(accountPreferenceKeys(keys)).toEqual(keys.slice(0, 6))
  })

  it("clears notifications, credentials, files and old account caches before unlocking sign-in", async () => {
    const events: string[] = []
    const preferences = new Map([[LOGOUT_PENDING_KEY, "true"], ["compass_field_profile_v1", "old-user"], ["compass_field_packet_v1.old-project", "private project"], ["compass_field_theme_v1", "dark"]])
    const result = await completeFieldLogout({
      stopNotifications: async () => { events.push("notifications") },
      clearCookies: async () => { events.push("cookies") },
      clearFiles: async () => { events.push("files") },
      keys: async () => ({ keys: [...preferences.keys()] }),
      remove: async ({ key }) => { events.push(key); preferences.delete(key) },
    })
    expect(result).toEqual({ success: true })
    expect(events.slice(0, 3)).toEqual(["notifications", "cookies", "files"])
    expect(events.at(-1)).toBe(LOGOUT_PENDING_KEY)
    expect([...preferences]).toEqual([["compass_field_theme_v1", "dark"]])
  })

  it.each(["notifications", "cookies", "files", "preferences"])("keeps logout locked and retryable when %s cleanup fails", async (failure) => {
    const remove = vi.fn(async ({ key }: { readonly key: string }) => { if (failure === "preferences") throw new Error(key) })
    const step = async (name: string): Promise<void> => { if (failure === name) throw new Error("unavailable") }
    const result = await completeFieldLogout({
      stopNotifications: () => step("notifications"), clearCookies: () => step("cookies"), clearFiles: () => step("files"),
      keys: async () => ({ keys: ["compass_field_profile_v1", LOGOUT_PENDING_KEY] }), remove,
    })
    expect(result.success).toBe(false)
    expect(remove).not.toHaveBeenCalledWith({ key: LOGOUT_PENDING_KEY })
  })
})
