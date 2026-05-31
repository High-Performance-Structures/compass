"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  type DatabaseProvider,
  type DrizzleDB,
  type ProviderType,
  detectPlatform,
} from "./interface"
import { createD1Provider, getD1FromContext } from "./d1-provider"
import { createTauriProvider } from "./tauri-provider"
import type { MemoryProviderConfig } from "./memory-types"

interface DatabaseContextValue {
  provider: DatabaseProvider | null
  isLoading: boolean
  error: Error | null
  platform: ProviderType
  getDb: () => Promise<DrizzleDB>
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null)

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext)
  if (!context) {
    throw new Error(
      "useDatabase must be used within a DatabaseProvider. " +
        "Wrap your app with <DatabaseProvider>."
    )
  }
  return context
}

export function useDb(): Promise<DrizzleDB> {
  const { getDb } = useDatabase()
  return getDb()
}

export interface DatabaseProviderProps {
  children: ReactNode
  // Override automatic platform detection
  forcePlatform?: ProviderType
  // Custom provider configuration
  config?: {
    d1?: Parameters<typeof createD1Provider>[0]
    tauri?: Parameters<typeof createTauriProvider>[0]
    memory?: MemoryProviderConfig
  }
}

function createUnavailableMemoryProvider(): DatabaseProvider {
  throw new Error(
    "Memory provider is only available through direct test imports. " +
      "Use D1 in the web app or Tauri SQLite in the desktop app."
  )
}

export function DatabaseProvider({
  children,
  forcePlatform,
  config,
}: DatabaseProviderProps) {
  const [provider, setProvider] = useState<DatabaseProvider | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const platform = forcePlatform ?? detectPlatform()

  useEffect(() => {
    let mounted = true

    async function initializeProvider() {
      try {
        setIsLoading(true)
        setError(null)

        let newProvider: DatabaseProvider

        switch (platform) {
          case "d1":
            newProvider = createD1Provider(
              config?.d1 ?? {
                getD1Database: getD1FromContext,
              }
            )
            break

          case "tauri":
            newProvider = createTauriProvider(config?.tauri)
            break

          case "memory":
          default: {
            newProvider = createUnavailableMemoryProvider()
            break
          }
        }

        if (mounted) {
          setProvider(newProvider)
          setIsLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setIsLoading(false)
        }
      }
    }

    initializeProvider()

    return () => {
      mounted = false
    }
  }, [platform, config])

  const getDb = async (): Promise<DrizzleDB> => {
    if (!provider) {
      throw new Error(
        "Database provider not initialized. " +
          (error?.message ?? "Unknown error")
      )
    }
    return provider.getDb()
  }

  return (
    <DatabaseContext.Provider
      value={{
        provider,
        isLoading,
        error,
        platform,
        getDb,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  )
}

// Hook for server-side usage (no context needed)
// This is for server actions and API routes
export async function getServerDb(): Promise<DrizzleDB> {
  const platform = detectPlatform()

  switch (platform) {
    case "d1": {
      const provider = createD1Provider({
        getD1Database: getD1FromContext,
      })
      return provider.getDb()
    }

    case "tauri": {
      // Tauri doesn't run on server
      throw new Error("Tauri provider cannot be used on the server")
    }

    case "memory":
    default: {
      // Memory provider is only for local development/testing.
      // On Cloudflare Workers, detectPlatform() returns "d1", so this
      // code path is never reached at runtime. However, bundlers like
      // esbuild still try to resolve the import. We throw an error here
      // since this code should never execute in production environments.
      throw new Error(
        "Memory provider not available in this environment. " +
          "Ensure you have a local SQLite setup or use the D1 provider."
      )
    }
  }
}
