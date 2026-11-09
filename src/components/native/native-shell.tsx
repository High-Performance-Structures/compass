"use client"

import { useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import { useNative } from "@/hooks/use-native"
import { loadStatusBarPlugin } from "@/lib/native/capacitor-plugins"

// Syncs native status bar style with the current theme
export function NativeShell() {
  const native = useNative()
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!native) return

    async function syncStatusBar() {
      const { StatusBar, Style } = await loadStatusBarPlugin()
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
