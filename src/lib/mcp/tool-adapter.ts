import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { saveMemory, searchMemories } from "@/lib/agent/memory"
import {
  installSkill as installSkillAction,
  uninstallSkill as uninstallSkillAction,
  toggleSkill as toggleSkillAction,
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"
import {
  getCustomThemes,
  setUserThemePreference,
} from "@/app/actions/themes"
import {
  getCustomDashboards,
} from "@/app/actions/dashboards"
import { THEME_PRESETS } from "@/lib/theme/presets"
import type { BridgeToolScope, BridgeToolMeta } from "@/lib/mcp/types"

function getString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key]
  return typeof v === "string" ? v : undefined
}

function getNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key]
  return typeof v === "number" ? v : undefined
}

function getBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = args[key]
  return typeof v === "boolean" ? v : undefined
}

type BridgeToolHandler = (
  userId: string,
  userRole: string,
  args: Record<string, unknown>,
) => Promise<unknown>

type BridgeToolEntry = Readonly<{
  handler: BridgeToolHandler
  scope: BridgeToolScope
  description: string
}>

const bridgeToolRegistry: Readonly<
  Record<string, BridgeToolEntry>
> = {
  queryData: {
    scope: "read",
    description:
      "Query the application database by type " +
      "(customers, vendors, projects, etc.)",
    handler: async (_userId, _userRole, args) => {
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)
      const queryType = getString(args, "queryType")
      if (!queryType) return { error: "queryType required" }
      const id = getString(args, "id")
      const search = getString(args, "search")
      const cap = getNumber(args, "limit") ?? 20

      switch (queryType) {
        case "customers": {
          const rows = await db.query.customers.findMany({
            limit: cap,
            ...(search
              ? {
                  where: (c, { like }) =>
                    like(c.name, `%${search}%`),
                }
              : {}),
          })
          return { data: rows, count: rows.length }
        }
        case "vendors": {
          const rows = await db.query.vendors.findMany({
            limit: cap,
            ...(search
              ? {
                  where: (v, { like }) =>
                    like(v.name, `%${search}%`),
                }
              : {}),
          })
          return { data: rows, count: rows.length }
        }
        case "projects": {
          const rows = await db.query.projects.findMany({
            limit: cap,
            ...(search
              ? {
                  where: (p, { like }) =>
                    like(p.name, `%${search}%`),
                }
              : {}),
          })
          return { data: rows, count: rows.length }
        }
        case "invoices": {
          const rows = await db.query.invoices.findMany({
            limit: cap,
          })
          return { data: rows, count: rows.length }
        }
        case "vendor_bills": {
          const rows = await db.query.vendorBills.findMany({
            limit: cap,
          })
          return { data: rows, count: rows.length }
        }
        case "schedule_tasks": {
          const rows =
            await db.query.scheduleTasks.findMany({
              limit: cap,
              ...(search
                ? {
                    where: (t, { like }) =>
                      like(t.title, `%${search}%`),
                  }
                : {}),
            })
          return { data: rows, count: rows.length }
        }
        case "project_detail": {
          if (!id) {
            return { error: "id required for detail query" }
          }
          const row =
            await db.query.projects.findFirst({
              where: (p, { eq }) => eq(p.id, id),
            })
          return row ? { data: row } : { error: "not found" }
        }
        case "customer_detail": {
          if (!id) {
            return { error: "id required for detail query" }
          }
          const row =
            await db.query.customers.findFirst({
              where: (c, { eq }) => eq(c.id, id),
            })
          return row ? { data: row } : { error: "not found" }
        }
        case "vendor_detail": {
          if (!id) {
            return { error: "id required for detail query" }
          }
          const row = await db.query.vendors.findFirst({
            where: (v, { eq }) => eq(v.id, id),
          })
          return row ? { data: row } : { error: "not found" }
        }
        default:
          return { error: "unknown query type" }
      }
    },
  },

  recallMemory: {
    scope: "read",
    description:
      "Search persistent memories for the user",
    handler: async (userId, _userRole, args) => {
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)
      const query = getString(args, "query")
      if (!query) return { error: "query required" }
      const limit = getNumber(args, "limit") ?? 5
      const results = await searchMemories(
        db,
        userId,
        query,
        limit,
      )
      return {
        action: "memory_recall",
        results,
        count: results.length,
      }
    },
  },

  listThemes: {
    scope: "read",
    description:
      "List available visual themes (presets + custom)",
    handler: async () => {
      const presets = THEME_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isPreset: true,
      }))

      const customResult = await getCustomThemes()
      const customs = customResult.success
        ? customResult.data.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            isPreset: false,
          }))
        : []

      return { themes: [...presets, ...customs] }
    },
  },

  listDashboards: {
    scope: "read",
    description: "List user's saved custom dashboards",
    handler: async () => {
      const result = await getCustomDashboards()
      if (!result.success) return { error: result.error }
      return {
        dashboards: result.data,
        count: result.data.length,
      }
    },
  },

  listInstalledSkills: {
    scope: "read",
    description:
      "List all installed agent skills with status",
    handler: async () => getInstalledSkillsAction(),
  },

  rememberContext: {
    scope: "write",
    description:
      "Save something to persistent memory",
    handler: async (userId, _userRole, args) => {
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)
      const content = getString(args, "content")
      if (!content) return { error: "content required" }
      const memoryType = getString(args, "memoryType")
      if (!memoryType) return { error: "memoryType required" }
      const tags = getString(args, "tags")
      const importance = getNumber(args, "importance")

      const id = await saveMemory(
        db,
        userId,
        content,
        memoryType,
        tags,
        importance,
      )
      return {
        action: "memory_saved",
        id,
        content,
        memoryType,
      }
    },
  },

  setTheme: {
    scope: "write",
    description: "Switch the user's visual theme",
    handler: async (_userId, _userRole, args) => {
      const themeId = getString(args, "themeId")
      if (!themeId) return { error: "themeId required" }
      const result = await setUserThemePreference(themeId)
      if (!result.success) return { error: result.error }
      return {
        action: "apply_theme",
        themeId,
      }
    },
  },

  installSkill: {
    scope: "admin",
    description:
      "Install a skill from GitHub (admin only)",
    handler: async (_userId, userRole, args) => {
      if (userRole !== "admin") {
        return {
          error: "admin role required to install skills",
        }
      }
      const source = getString(args, "source")
      if (!source) return { error: "source required" }
      return installSkillAction(source)
    },
  },

  uninstallSkill: {
    scope: "admin",
    description:
      "Remove an installed skill (admin only)",
    handler: async (_userId, userRole, args) => {
      if (userRole !== "admin") {
        return { error: "admin role required" }
      }
      const pluginId = getString(args, "pluginId")
      if (!pluginId) return { error: "pluginId required" }
      return uninstallSkillAction(pluginId)
    },
  },

  toggleInstalledSkill: {
    scope: "admin",
    description:
      "Enable or disable an installed skill (admin only)",
    handler: async (_userId, userRole, args) => {
      if (userRole !== "admin") {
        return { error: "admin role required" }
      }
      const pluginId = getString(args, "pluginId")
      if (!pluginId) return { error: "pluginId required" }
      const enabled = getBoolean(args, "enabled")
      if (enabled === undefined) {
        return { error: "enabled required" }
      }
      return toggleSkillAction(pluginId, enabled)
    },
  },
}

const SCOPE_HIERARCHY: Readonly<
  Record<BridgeToolScope, ReadonlyArray<BridgeToolScope>>
> = {
  read: ["read"],
  write: ["read", "write"],
  admin: ["read", "write", "admin"],
}

function hasScope(
  userScopes: ReadonlyArray<string>,
  requiredScope: BridgeToolScope,
): boolean {
  return userScopes.some((s) => {
    const allowed =
      SCOPE_HIERARCHY[s as BridgeToolScope]
    return allowed !== undefined &&
      allowed.includes(requiredScope)
  })
}

export async function executeBridgeTool(
  toolName: string,
  userId: string,
  userRole: string,
  args: Record<string, unknown>,
  scopes: ReadonlyArray<string>,
): Promise<
  | { readonly success: true; readonly result: unknown }
  | { readonly success: false; readonly error: string }
> {
  const entry = bridgeToolRegistry[toolName]
  if (!entry) {
    return {
      success: false,
      error: `unknown tool: ${toolName}`,
    }
  }

  if (!hasScope(scopes, entry.scope)) {
    return {
      success: false,
      error:
        `insufficient scope: "${entry.scope}" ` +
        `required for tool "${toolName}"`,
    }
  }

  try {
    const result = await entry.handler(
      userId,
      userRole,
      args,
    )
    return { success: true, result }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "tool failed"
    return { success: false, error: message }
  }
}

export function getAvailableTools(
  scopes: ReadonlyArray<string>,
): ReadonlyArray<BridgeToolMeta> {
  const tools: Array<BridgeToolMeta> = []

  for (const [name, entry] of Object.entries(
    bridgeToolRegistry,
  )) {
    if (hasScope(scopes, entry.scope)) {
      tools.push({
        name,
        description: entry.description,
        scope: entry.scope,
      })
    }
  }

  return tools
}
