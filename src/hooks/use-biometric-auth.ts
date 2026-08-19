"use client"

import { useState, useEffect, useCallback } from "react"
import { useNative } from "./use-native"

const BIOMETRIC_ENABLED_KEY = "compass_biometric_enabled"
const BIOMETRIC_PROMPTED_KEY = "compass_biometric_prompted"

type BiometricState = Readonly<{
  isLoaded: boolean
  isAvailable: boolean
  isEnabled: boolean
  hasBeenPrompted: boolean
}>

export function useBiometricAuth() {
  const native = useNative()
  const [state, setState] = useState<BiometricState>({
    isLoaded: false,
    isAvailable: false,
    isEnabled: false,
    hasBeenPrompted: false,
  })

  useEffect(() => {
    if (!native) return

    async function check() {
      try {
        const [{ NativeBiometric }, { Preferences }] = await Promise.all([
          import("@capgo/capacitor-native-biometric"),
          import("@capacitor/preferences"),
        ])
        const result =
          await NativeBiometric.isAvailable()

        const [storedEnabled, storedPrompted] = await Promise.all([
          Preferences.get({ key: BIOMETRIC_ENABLED_KEY }),
          Preferences.get({ key: BIOMETRIC_PROMPTED_KEY }),
        ])
        const legacyEnabled = localStorage.getItem(BIOMETRIC_ENABLED_KEY)
        const legacyPrompted = localStorage.getItem(BIOMETRIC_PROMPTED_KEY)
        const enabled =
          storedEnabled.value === null
            ? legacyEnabled === "true"
            : storedEnabled.value === "true"
        const prompted =
          storedPrompted.value === null
            ? legacyPrompted === "true"
            : storedPrompted.value === "true"

        // Native storage is shared by the bundled shell and live origin.
        if (storedEnabled.value === null) {
          await Preferences.set({
            key: BIOMETRIC_ENABLED_KEY,
            value: String(enabled),
          })
        }
        if (storedPrompted.value === null) {
          await Preferences.set({
            key: BIOMETRIC_PROMPTED_KEY,
            value: String(prompted),
          })
        }
        localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
        localStorage.removeItem(BIOMETRIC_PROMPTED_KEY)

        setState({
          isLoaded: true,
          isAvailable: result.isAvailable,
          isEnabled: enabled,
          hasBeenPrompted: prompted,
        })
      } catch {
        // biometric not supported on this device
        setState((previous) => ({ ...previous, isLoaded: true }))
      }
    }

    check()
  }, [native])

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!native) return true
    try {
      const { NativeBiometric } = await import(
        "@capgo/capacitor-native-biometric"
      )
      await NativeBiometric.verifyIdentity({
        reason: "Unlock Compass",
        title: "Authentication Required",
      })
      return true
    } catch {
      return false
    }
  }, [native])

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      const { Preferences } = await import("@capacitor/preferences")
      await Preferences.set({
        key: BIOMETRIC_ENABLED_KEY,
        value: String(enabled),
      })
      setState((prev) => ({ ...prev, isEnabled: enabled }))
    },
    [],
  )

  const markPrompted = useCallback(async (): Promise<void> => {
    const { Preferences } = await import("@capacitor/preferences")
    await Preferences.set({ key: BIOMETRIC_PROMPTED_KEY, value: "true" })
    setState((prev) => ({
      ...prev,
      hasBeenPrompted: true,
    }))
  }, [])

  return {
    ...state,
    authenticate,
    setEnabled,
    markPrompted,
  }
}
