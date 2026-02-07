"use client"

import { useSyncExternalStore } from "react"
import { isNative, isIOS, isAndroid, getPlatform } from "@/lib/native/platform"

// Snapshot never changes after initial load (Capacitor injects before hydration)
function subscribe(_onStoreChange: () => void): () => void {
  return () => {}
}

function getSnapshot(): boolean {
  return isNative()
}

function getServerSnapshot(): boolean {
  return false
}

export function useNative(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useNativePlatform(): "ios" | "android" | "web" {
  return useSyncExternalStore(
    subscribe,
    () => getPlatform(),
    () => "web" as const,
  )
}

export { isIOS, isAndroid }
