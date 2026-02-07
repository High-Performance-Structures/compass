"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useNative } from "@/hooks/use-native"
import { useBiometricAuth } from "@/hooks/use-biometric-auth"
import { Fingerprint, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"

const BACKGROUND_THRESHOLD_MS = 30_000

export function BiometricGuard({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const native = useNative()
  const {
    isAvailable,
    isEnabled,
    hasBeenPrompted,
    authenticate,
    setEnabled,
    markPrompted,
  } = useBiometricAuth()

  const [locked, setLocked] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const backgroundedAt = useRef<number | null>(null)

  // listen for app state changes (background/foreground)
  useEffect(() => {
    if (!native || !isEnabled) return

    let cleanup: (() => void) | undefined

    async function setup() {
      const { App } = await import("@capacitor/app")
      const listener = await App.addListener(
        "appStateChange",
        (state) => {
          if (!state.isActive) {
            backgroundedAt.current = Date.now()
          } else if (backgroundedAt.current !== null) {
            const elapsed =
              Date.now() - backgroundedAt.current
            backgroundedAt.current = null
            if (elapsed > BACKGROUND_THRESHOLD_MS) {
              setLocked(true)
            }
          }
        },
      )
      cleanup = () => listener.remove()
    }

    setup()
    return () => cleanup?.()
  }, [native, isEnabled])

  // auto-authenticate when lock screen appears
  useEffect(() => {
    if (!locked) return
    authenticate().then((success) => {
      if (success) setLocked(false)
    })
  }, [locked, authenticate])

  // first-login prompt for enabling biometric
  useEffect(() => {
    if (
      native &&
      isAvailable &&
      !isEnabled &&
      !hasBeenPrompted
    ) {
      // small delay so the dashboard renders first
      const timer = setTimeout(() => setShowPrompt(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [native, isAvailable, isEnabled, hasBeenPrompted])

  const handleEnableBiometric = useCallback(async () => {
    const success = await authenticate()
    if (success) {
      setEnabled(true)
    }
    markPrompted()
    setShowPrompt(false)
  }, [authenticate, setEnabled, markPrompted])

  const handleSkipBiometric = useCallback(() => {
    markPrompted()
    setShowPrompt(false)
  }, [markPrompted])

  const handleUnlockWithPassword = useCallback(() => {
    // navigates to login page -- the auth middleware will handle
    // re-authentication via WorkOS
    window.location.href = "/login"
  }, [])

  const handleRetryBiometric = useCallback(async () => {
    const success = await authenticate()
    if (success) setLocked(false)
  }, [authenticate])

  if (!native) return <>{children}</>

  return (
    <>
      {children}

      {/* lock screen overlay */}
      {locked && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/95 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-3">
            <Fingerprint className="h-16 w-16 text-muted-foreground" />
            <p className="text-lg font-medium">
              Compass is locked
            </p>
            <p className="text-sm text-muted-foreground">
              Authenticate to continue
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={handleRetryBiometric} size="lg">
              Unlock
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnlockWithPassword}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Use password
            </Button>
          </div>
        </div>
      )}

      {/* opt-in prompt */}
      {showPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="mx-4 flex max-w-sm flex-col gap-4 rounded-2xl bg-background p-6 shadow-2xl">
            <div className="flex flex-col items-center gap-2 text-center">
              <Fingerprint className="h-12 w-12 text-primary" />
              <h3 className="text-lg font-semibold">
                Secure with biometrics?
              </h3>
              <p className="text-sm text-muted-foreground">
                Use Face ID or fingerprint to lock Compass
                when you switch apps.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleEnableBiometric}>
                Enable
              </Button>
              <Button
                variant="ghost"
                onClick={handleSkipBiometric}
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
