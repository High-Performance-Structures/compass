import { tool } from "ai"
import { z } from "zod/v4"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { saveMemory, searchMemories } from "@/lib/agent/memory"
import {
  installSkill as installSkillAction,
  uninstallSkill as uninstallSkillAction,
  toggleSkill as toggleSkillAction,
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"

const queryDataInputSchema = z.object({
  queryType: z.enum([
    "customers",
    "vendors",
    "projects",
    "invoices",
    "vendor_bills",
    "schedule_tasks",
    "project_detail",
    "customer_detail",
    "vendor_detail",
  ]),
  id: z
    .string()
    .optional()
    .describe("Record ID for detail queries"),
  search: z
    .string()
    .optional()
    .describe("Search term to filter results"),
  limit: z
    .number()
    .optional()
    .describe("Max results to return (default 20)"),
})

type QueryDataInput = z.infer<typeof queryDataInputSchema>

const VALID_ROUTES: ReadonlyArray<RegExp> = [
  /^\/dashboard$/,
  /^\/dashboard\/customers$/,
  /^\/dashboard\/vendors$/,
  /^\/dashboard\/projects$/,
  /^\/dashboard\/projects\/[^/]+$/,
  /^\/dashboard\/projects\/[^/]+\/schedule$/,
  /^\/dashboard\/financials$/,
  /^\/dashboard\/people$/,
  /^\/dashboard\/files$/,
  /^\/dashboard\/files\/.+$/,
]

function isValidRoute(path: string): boolean {
  return VALID_ROUTES.some((r) => r.test(path))
}

const navigateInputSchema = z.object({
  path: z
    .string()
    .describe("The URL path to navigate to"),
  reason: z
    .string()
    .optional()
    .describe("Brief explanation of why navigating"),
})

type NavigateInput = z.infer<typeof navigateInputSchema>

const notificationInputSchema = z.object({
  message: z.string().describe("The notification message"),
  type: z
    .enum(["default", "success", "error"])
    .optional()
    .describe("Notification style"),
})

type NotificationInput = z.infer<
  typeof notificationInputSchema
>

const generateUIInputSchema = z.object({
  description: z.string().describe(
    "Layout and content description for the " +
      "dashboard to generate. Be specific about " +
      "what components and data to display."
  ),
  dataContext: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Data to include in the rendered UI. " +
        "Pass query results here."
    ),
})

type GenerateUIInput = z.infer<
  typeof generateUIInputSchema
>

const rememberInputSchema = z.object({
  content: z.string().describe(
    "What to remember (a preference, decision, fact, or workflow)"
  ),
  memoryType: z.enum([
    "preference",
    "workflow",
    "fact",
    "decision",
  ]).describe("Category of memory"),
  tags: z
    .string()
    .optional()
    .describe("Comma-separated tags for categorization"),
  importance: z
    .number()
    .min(0.3)
    .max(1.0)
    .optional()
    .describe("Importance weight 0.3-1.0 (default 0.7)"),
})

type RememberInput = z.infer<typeof rememberInputSchema>

const recallInputSchema = z.object({
  query: z
    .string()
    .describe("What to search for in memories"),
  limit: z
    .number()
    .optional()
    .describe("Max results (default 5)"),
})

type RecallInput = z.infer<typeof recallInputSchema>

async function executeQueryData(input: QueryDataInput) {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const cap = input.limit ?? 20

  switch (input.queryType) {
    case "customers": {
      const rows = await db.query.customers.findMany({
        limit: cap,
        ...(input.search
          ? {
              where: (c, { like }) =>
                like(c.name, `%${input.search}%`),
            }
          : {}),
      })
      return { data: rows, count: rows.length }
    }

    case "vendors": {
      const rows = await db.query.vendors.findMany({
        limit: cap,
        ...(input.search
          ? {
              where: (v, { like }) =>
                like(v.name, `%${input.search}%`),
            }
          : {}),
      })
      return { data: rows, count: rows.length }
    }

    case "projects": {
      const rows = await db.query.projects.findMany({
        limit: cap,
        ...(input.search
          ? {
              where: (p, { like }) =>
                like(p.name, `%${input.search}%`),
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
      const rows = await db.query.scheduleTasks.findMany({
        limit: cap,
        ...(input.search
          ? {
              where: (t, { like }) =>
                like(t.title, `%${input.search}%`),
            }
          : {}),
      })
      return { data: rows, count: rows.length }
    }

    case "project_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.projects.findFirst({
        where: (p, { eq }) => eq(p.id, input.id!),
      })
      return row ? { data: row } : { error: "not found" }
    }

    case "customer_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.customers.findFirst({
        where: (c, { eq }) => eq(c.id, input.id!),
      })
      return row ? { data: row } : { error: "not found" }
    }

    case "vendor_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.vendors.findFirst({
        where: (v, { eq }) => eq(v.id, input.id!),
      })
      return row ? { data: row } : { error: "not found" }
    }

    default:
      return { error: "unknown query type" }
  }
}

export const agentTools = {
  queryData: tool({
    description:
      "Query the application database. Describe what data " +
      "you need in natural language and provide a query type.",
    inputSchema: queryDataInputSchema,
    execute: async (input: QueryDataInput) =>
      executeQueryData(input),
  }),

  navigateTo: tool({
    description:
      "Navigate the user to a page in the application. " +
      "Returns navigation data for the client to execute.",
    inputSchema: navigateInputSchema,
    execute: async (input: NavigateInput) => {
      if (!isValidRoute(input.path)) {
        return {
          error:
            `"${input.path}" is not a valid page. ` +
            "Valid: /dashboard, /dashboard/projects, " +
            "/dashboard/projects/{id}, " +
            "/dashboard/projects/{id}/schedule, " +
            "/dashboard/customers, /dashboard/vendors, " +
            "/dashboard/financials, /dashboard/people, " +
            "/dashboard/files",
        }
      }
      return {
        action: "navigate" as const,
        path: input.path,
        reason: input.reason ?? null,
      }
    },
  }),

  showNotification: tool({
    description:
      "Show a toast notification to the user. Use for " +
      "confirmations or important alerts.",
    inputSchema: notificationInputSchema,
    execute: async (input: NotificationInput) => ({
      action: "toast" as const,
      message: input.message,
      type: input.type ?? "default",
    }),
  }),

  generateUI: tool({
    description:
      "Generate a rich interactive UI dashboard. " +
      "Use when the user wants to see structured " +
      "data (tables, charts, stats, forms). Always " +
      "fetch data with queryData first, then pass " +
      "it here as dataContext.",
    inputSchema: generateUIInputSchema,
    execute: async (input: GenerateUIInput) => ({
      action: "generateUI" as const,
      renderPrompt: input.description,
      dataContext: input.dataContext ?? {},
    }),
  }),

  rememberContext: tool({
    description:
      "Save something to persistent memory. Use when the " +
      "user shares a preference, makes a decision, or " +
      "mentions a fact worth remembering across sessions.",
    inputSchema: rememberInputSchema,
    execute: async (input: RememberInput) => {
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }

      const id = await saveMemory(
        db,
        user.id,
        input.content,
        input.memoryType,
        input.tags,
        input.importance,
      )
      return {
        action: "memory_saved" as const,
        id,
        content: input.content,
        memoryType: input.memoryType,
      }
    },
  }),

  recallMemory: tool({
    description:
      "Search persistent memories for this user. Use when " +
      "the user asks if you remember something or when you " +
      "need to look up a past preference or decision.",
    inputSchema: recallInputSchema,
    execute: async (input: RecallInput) => {
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }

      const results = await searchMemories(
        db,
        user.id,
        input.query,
        input.limit,
      )
      return {
        action: "memory_recall" as const,
        results,
        count: results.length,
      }
    },
  }),

  installSkill: tool({
    description:
      "Install a skill from GitHub (skills.sh format). " +
      "Source format: owner/repo or owner/repo/skill-name. " +
      "Requires admin role. Always confirm with the user " +
      "what skill they want before installing.",
    inputSchema: z.object({
      source: z.string().describe(
        "GitHub source path, e.g. " +
        "'cloudflare/skills/wrangler'",
      ),
    }),
    execute: async (input: { source: string }) => {
      const user = await getCurrentUser()
      if (!user || user.role !== "admin") {
        return { error: "admin role required to install skills" }
      }
      return installSkillAction(input.source)
    },
  }),

  listInstalledSkills: tool({
    description:
      "List all installed agent skills with their status.",
    inputSchema: z.object({}),
    execute: async () => getInstalledSkillsAction(),
  }),

  toggleInstalledSkill: tool({
    description:
      "Enable or disable an installed skill.",
    inputSchema: z.object({
      pluginId: z.string().describe("The plugin ID of the skill"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    }),
    execute: async (input: {
      pluginId: string
      enabled: boolean
    }) => {
      const user = await getCurrentUser()
      if (!user || user.role !== "admin") {
        return { error: "admin role required" }
      }
      return toggleSkillAction(input.pluginId, input.enabled)
    },
  }),

  uninstallSkill: tool({
    description:
      "Remove an installed skill permanently. " +
      "Requires admin role. Always confirm before uninstalling.",
    inputSchema: z.object({
      pluginId: z.string().describe("The plugin ID of the skill"),
    }),
    execute: async (input: { pluginId: string }) => {
      const user = await getCurrentUser()
      if (!user || user.role !== "admin") {
        return { error: "admin role required" }
      }
      return uninstallSkillAction(input.pluginId)
    },
  }),
}
