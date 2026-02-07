"use client"

import { useState, useEffect } from "react"
import { WifiOff } from "lucide-react"
import { useNative } from "@/hooks/use-native"

export function OfflineBanner() {
  const native = useNative()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!native) {
      // web fallback: use navigator.onLine
      const handleOnline = () => setOffline(false)
      const handleOffline = () => setOffline(true)
      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)
      setOffline(!navigator.onLine)
      return () => {
        window.removeEventListener("online", handleOnline)
        window.removeEventListener("offline", handleOffline)
      }
    }

    let cleanup: (() => void) | undefined

    async function setup() {
      const { Network } = await import(
        "@capacitor/network"
      )
      const status = await Network.getStatus()
      setOffline(!status.connected)

      const listener = await Network.addListener(
        "networkStatusChange",
        (s) => setOffline(!s.connected),
      )
      cleanup = () => listener.remove()
    }

    setup()
    return () => cleanup?.()
  }, [native])

  if (!offline) return null

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-1.5 text-xs font-medium text-white dark:bg-amber-600/90">
      <WifiOff className="h-3.5 w-3.5" />
      You&apos;re offline. Some features may be unavailable.
    </div>
  )
}
