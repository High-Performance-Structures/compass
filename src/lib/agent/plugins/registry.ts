import type {
  PluginModule,
  PromptSection,
  PluginComponent,
  PluginQueryType,
  PluginActionHandler,
  PluginSourceType,
} from "./types"
import { isSemVer } from "./types"
import { loadPluginModule, validateEnvVars } from "./loader"
import { plugins } from "@/db/schema-plugins"

interface PluginRegistry {
  readonly plugins: ReadonlyMap<string, PluginModule>
  getTools(): Readonly<Record<string, unknown>>
  getPromptSections(): ReadonlyArray<PromptSection>
  getComponents(): ReadonlyArray<PluginComponent>
  getQueryTypes(): ReadonlyArray<PluginQueryType>
  getActionHandlers(): ReadonlyArray<PluginActionHandler>
}

function createRegistry(
  loaded: ReadonlyMap<string, PluginModule>,
): PluginRegistry {
  return {
    plugins: loaded,

    getTools() {
      const merged: Record<string, unknown> = {}
      for (const mod of loaded.values()) {
        if (mod.tools) {
          Object.assign(merged, mod.tools)
        }
      }
      return merged
    },

    getPromptSections() {
      const sections: Array<PromptSection> = []
      for (const mod of loaded.values()) {
        if (mod.promptSections) {
          sections.push(...mod.promptSections)
        }
      }
      return sections.sort(
        (a, b) => (a.priority ?? 50) - (b.priority ?? 50),
      )
    },

    getComponents() {
      const components: Array<PluginComponent> = []
      for (const mod of loaded.values()) {
        if (mod.components) {
          components.push(...mod.components)
        }
      }
      return components
    },

    getQueryTypes() {
      const types: Array<PluginQueryType> = []
      for (const mod of loaded.values()) {
        if (mod.queryTypes) {
          types.push(...mod.queryTypes)
        }
      }
      return types
    },

    getActionHandlers() {
      const handlers: Array<PluginActionHandler> = []
      for (const mod of loaded.values()) {
        if (mod.actionHandlers) {
          handlers.push(...mod.actionHandlers)
        }
      }
      return handlers
    },
  }
}

// row shape from the plugins table
interface PluginRow {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly source: string
  readonly sourceType: string
  readonly status: string
}

// drizzle db type - kept generic to avoid circular imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryMethod = (...args: ReadonlyArray<any>) => any

interface DbClient {
  select(): {
    from(
      table: typeof plugins,
    ): Promise<ReadonlyArray<PluginRow>>
  }
  query: {
    pluginConfig: {
      findFirst: AnyQueryMethod
    }
  }
}

function isPluginSourceType(
  value: string,
): value is PluginSourceType {
  return (
    value === "builtin" ||
    value === "local" ||
    value === "npm"
  )
}

export async function buildRegistry(
  db: DbClient,
  env: Readonly<Record<string, string>>,
): Promise<PluginRegistry> {
  const rows = await db
    .select()
    .from(plugins)

  const enabledRows = rows.filter(
    (r) => r.status === "enabled",
  )

  const loaded = new Map<string, PluginModule>()

  for (const row of enabledRows) {
    if (row.sourceType === "skills") {
      const configRow = await db.query.pluginConfig.findFirst({
        where: (
          c: Record<string, unknown>,
          ops: Record<string, (...args: ReadonlyArray<unknown>) => unknown>,
        ) => ops.and(
          ops.eq(c.pluginId, row.id),
          ops.eq(c.key, "content"),
        ),
      })
      if (!configRow) continue

      const version = "1.0.0"
      const mod: PluginModule = {
        manifest: {
          id: row.id,
          name: row.name,
          description: row.description ?? "",
          version: (isSemVer(version) ? version : "1.0.0") as
            string & { readonly __brand: "SemVer" },
          capabilities: ["prompt"],
        },
        promptSections: [{
          heading: row.name,
          content: configRow.value,
          priority: 80,
        }],
      }
      loaded.set(row.id, mod)
      continue
    }

    if (!isPluginSourceType(row.sourceType)) continue

    const result = await loadPluginModule(
      row.source,
      row.sourceType,
    )
    if (!result.success) continue

    const missing = validateEnvVars(
      result.module.manifest,
      env,
    )
    if (missing.length > 0) continue

    loaded.set(row.id, result.module)
  }

  return createRegistry(loaded)
}

// simple cache for CF workers (one registry per isolate lifetime)
let cached: {
  readonly registry: PluginRegistry
  readonly expiresAt: number
} | null = null

const TTL_MS = 30_000

export async function getRegistry(
  db: DbClient,
  env: Readonly<Record<string, string>>,
): Promise<PluginRegistry> {
  const now = Date.now()
  if (cached && now < cached.expiresAt) {
    return cached.registry
  }

  const registry = await buildRegistry(db, env)
  cached = { registry, expiresAt: now + TTL_MS }
  return registry
}

// for testing - clears the cached registry
export function clearRegistryCache(): void {
  cached = null
}
