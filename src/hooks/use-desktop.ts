"use client"

import { useSyncExternalStore, useCallback } from "react"
import { isElectron, isDesktop, getPlatform, type Platform } from "@/lib/native/platform"
import type { DesktopReadyState } from "@/types/desktop-bridge"

// SSR-safe subscribe (never changes after initial load)
function subscribe(): () => void {
  return () => {}
}

function getSnapshot(): boolean {
  return isDesktop()
}

function getServerSnapshot(): boolean {
  return false
}

export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Hook to get the desktop platform (windows, macos, linux, or web)
export function useDesktopPlatform(): Platform {
  return useSyncExternalStore(
    subscribe,
    () => getPlatform(),
    () => "web" as const,
  )
}

function getDesktopReadySnapshot(): DesktopReadyState {
  if (typeof window === "undefined") return "loading"
  return window.compassDesktop ? "ready" : "error"
}

function getDesktopReadyServerSnapshot(): DesktopReadyState {
  return "loading"
}

export function useDesktopReady(): DesktopReadyState {
  return useSyncExternalStore(
    subscribe,
    getDesktopReadySnapshot,
    getDesktopReadyServerSnapshot,
  )
}

export function useDesktopBridge() {
  const isReady = useDesktopReady()

  return useCallback(() => {
    if (isReady !== "ready") return null
    return window.compassDesktop ?? null
  }, [isReady])
}

export { isElectron }
