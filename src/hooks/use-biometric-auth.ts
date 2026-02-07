"use client"

import { useState, useEffect, useCallback } from "react"
import { useNative } from "./use-native"

const BIOMETRIC_ENABLED_KEY = "compass_biometric_enabled"
const BIOMETRIC_PROMPTED_KEY = "compass_biometric_prompted"

type BiometricState = Readonly<{
  isAvailable: boolean
  isEnabled: boolean
  hasBeenPrompted: boolean
}>

export function useBiometricAuth() {
  const native = useNative()
  const [state, setState] = useState<BiometricState>({
    isAvailable: false,
    isEnabled: false,
    hasBeenPrompted: false,
  })

  useEffect(() => {
    if (!native) return

    async function check() {
      try {
        const { NativeBiometric } = await import(
          "@capgo/capacitor-native-biometric"
        )
        const result =
          await NativeBiometric.isAvailable()

        const enabled =
          localStorage.getItem(BIOMETRIC_ENABLED_KEY) ===
          "true"
        const prompted =
          localStorage.getItem(
            BIOMETRIC_PROMPTED_KEY,
          ) === "true"

        setState({
          isAvailable: result.isAvailable,
          isEnabled: enabled,
          hasBeenPrompted: prompted,
        })
      } catch {
        // biometric not supported on this device
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
    (enabled: boolean) => {
      localStorage.setItem(
        BIOMETRIC_ENABLED_KEY,
        String(enabled),
      )
      setState((prev) => ({ ...prev, isEnabled: enabled }))
    },
    [],
  )

  const markPrompted = useCallback(() => {
    localStorage.setItem(BIOMETRIC_PROMPTED_KEY, "true")
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
