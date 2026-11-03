"use client"

import { useSyncExternalStore } from "react"
import { isDesktop } from "@/lib/native/platform"
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

