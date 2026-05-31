// Database provider abstraction layer
// Supports D1 (Cloudflare), Electron (desktop), and in-memory (testing)

// Interface and types
export {
  type DatabaseProvider as DatabaseProviderInterface,
  type DrizzleDB,
  type ProviderType,
  isElectron,
  isCloudflareWorker,
  detectPlatform,
} from "./interface"

// Provider implementations
export {
  createD1Provider,
  getD1FromContext,
  type D1ProviderConfig,
} from "./d1-provider"

export {
  createElectronProvider,
  type ElectronProviderConfig,
} from "./electron-provider"

// Memory provider is only exported as type for config purposes
// Use dynamic import: const { createMemoryProvider } = await import("./memory-provider")
export type { MemoryProviderConfig } from "./memory-types"

// React context and hooks
export {
  DatabaseProvider,
  useDatabase,
  useDb,
  getServerDb,
} from "./context"
export type { DatabaseProviderProps } from "./context"
