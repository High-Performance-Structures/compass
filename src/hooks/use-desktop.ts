"use client"

import { useSyncExternalStore, useCallback } from "react"
import { isTauri, isDesktop, getPlatform, type Platform } from "@/lib/native/platform"

// SSR-safe subscribe (never changes after initial load)
function subscribe(_onStoreChange: () => void): () => void {
  return () => {}
}

function getSnapshot(): boolean {
  return isDesktop()
}

function getServerSnapshot(): boolean {
  return false
}

// Hook to check if running in Tauri desktop environment
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

// Hook to check if Tauri is ready (API is available)
type TauriReadyState = "loading" | "ready" | "error"

function getTauriReadySnapshot(): TauriReadyState {
  if (typeof window === "undefined") return "loading"
  const tauri = (window as unknown as Record<string, unknown>).__TAURI__
  if (!tauri) return "error"
  return "ready"
}

function getTauriReadyServerSnapshot(): TauriReadyState {
  return "loading"
}

export function useTauriReady(): TauriReadyState {
  return useSyncExternalStore(
    subscribe,
    getTauriReadySnapshot,
    getTauriReadyServerSnapshot,
  )
}

// Utility to safely invoke Tauri commands
export async function invokeTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null

  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<T>(cmd, args)
  } catch (error) {
    console.error(`Tauri invoke error (${cmd}):`, error)
    return null
  }
}

// Hook for invoking Tauri commands with loading state
export function useTauriInvoke() {
  const isReady = useTauriReady()

  return useCallback(
    async <T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> => {
      if (isReady !== "ready") return null
      return invokeTauri<T>(cmd, args)
    },
    [isReady],
  )
}

// Re-export isTauri for direct use
export { isTauri }
