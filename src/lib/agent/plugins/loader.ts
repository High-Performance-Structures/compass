import type {
  PluginModule,
  PluginManifest,
  PluginResult,
  PluginSourceType,
} from "./types"
import { PLUGIN_CAPABILITIES, isSemVer } from "./types"

// lazy import map for builtin plugins
// actual plugin directories created in follow-up PRs
const BUILTIN_PLUGINS: Readonly<
  Record<string, () => Promise<{ default: PluginModule }>>
> = {
  // core: () => import("./core"),
  // github: () => import("./github"),
}

function validateManifest(
  manifest: unknown,
): PluginResult & { readonly manifest?: PluginManifest } {
  if (
    typeof manifest !== "object" ||
    manifest === null
  ) {
    return {
      success: false,
      error: "manifest is not an object",
    }
  }

  const m = manifest as Record<string, unknown>

  if (typeof m.id !== "string" || m.id.length === 0) {
    return {
      success: false,
      error: "manifest.id must be a non-empty string",
    }
  }

  if (!/^[a-z0-9-]+$/.test(m.id)) {
    return {
      success: false,
      error: "manifest.id must be kebab-case",
    }
  }

  if (
    typeof m.name !== "string" ||
    m.name.length === 0
  ) {
    return {
      success: false,
      error: "manifest.name must be a non-empty string",
    }
  }

  if (typeof m.description !== "string") {
    return {
      success: false,
      error: "manifest.description must be a string",
    }
  }

  if (
    typeof m.version !== "string" ||
    !isSemVer(m.version)
  ) {
    return {
      success: false,
      error: "manifest.version must be valid semver",
    }
  }

  if (!Array.isArray(m.capabilities)) {
    return {
      success: false,
      error: "manifest.capabilities must be an array",
    }
  }

  const validCaps = new Set<string>(PLUGIN_CAPABILITIES)
  for (const cap of m.capabilities) {
    if (!validCaps.has(cap as string)) {
      return {
        success: false,
        error: `unknown capability: ${String(cap)}`,
      }
    }
  }

  return {
    success: true,
    manifest: m as unknown as PluginManifest,
  }
}

export function validateEnvVars(
  manifest: PluginManifest,
  env: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  if (!manifest.requiredEnvVars) return []
  const missing: Array<string> = []
  for (const v of manifest.requiredEnvVars) {
    if (!env[v]) missing.push(v)
  }
  return missing
}

type LoadResult =
  | { readonly success: true; readonly module: PluginModule }
  | { readonly success: false; readonly error: string }

export async function loadPluginModule(
  source: string,
  sourceType: PluginSourceType,
): Promise<LoadResult> {
  switch (sourceType) {
    case "builtin": {
      const loader = BUILTIN_PLUGINS[source]
      if (!loader) {
        return {
          success: false,
          error: `unknown builtin plugin: ${source}`,
        }
      }
      try {
        const mod = await loader()
        const validation = validateManifest(
          mod.default.manifest,
        )
        if (!validation.success) {
          return {
            success: false,
            error: validation.error,
          }
        }
        return { success: true, module: mod.default }
      } catch (err) {
        return {
          success: false,
          error: `failed to load builtin plugin ${source}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }
      }
    }

    case "local":
    case "npm":
      return {
        success: false,
        error: `${sourceType} plugins not yet supported`,
      }

    case "skills":
      return {
        success: false,
        error: "skills are loaded via registry, not loader",
      }
  }
}

export function getBuiltinPluginIds(): ReadonlyArray<string> {
  return Object.keys(BUILTIN_PLUGINS)
}
