"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { useNative } from "@/hooks/use-native"

// Syncs native status bar style with the current theme
export function NativeShell() {
  const native = useNative()
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!native) return

    async function syncStatusBar() {
      const { StatusBar, Style } = await import(
        "@capacitor/status-bar"
      )
      try {
        await StatusBar.setStyle({
          style:
            resolvedTheme === "dark"
              ? Style.Dark
              : Style.Light,
        })
      } catch {
        // status bar not available (e.g. Android immersive)
      }
    }

    syncStatusBar()
  }, [native, resolvedTheme])

  return null
}
