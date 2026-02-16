import { tool } from "ai"
import { z } from "zod/v4"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { saveMemory, searchMemories } from "@/lib/agent/memory"
import {
  installSkill as installSkillAction,
  uninstallSkill as uninstallSkillAction,
  toggleSkill as toggleSkillAction,
  getInstalledSkills as getInstalledSkillsAction,
} from "@/app/actions/plugins"
import {
  getCustomThemes,
  getCustomThemeById,
  saveCustomTheme,
  setUserThemePreference,
} from "@/app/actions/themes"
import {
  getCustomDashboards,
  getCustomDashboardById,
  deleteCustomDashboard,
} from "@/app/actions/dashboards"
import { THEME_PRESETS, findPreset } from "@/lib/theme/presets"
import type { ThemeDefinition, ColorMap, ThemeFonts, ThemeTokens, ThemeShadows } from "@/lib/theme/types"
import { projects, scheduleTasks, taskDependencies, workdayExceptions } from "@/db/schema"
import { invoices, vendorBills } from "@/db/schema-netsuite"
import { eq, and, like, asc } from "drizzle-orm"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import { wouldCreateCycle } from "@/lib/schedule/dependency-validation"
import { propagateDates } from "@/lib/schedule/propagate-dates"
import { revalidatePath } from "next/cache"
import { isDemoUser } from "@/lib/demo"
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

// shared auth + project verification for schedule tools.
// uses ID-only lookup (no org check) to match the schedule
// page behavior -- the middleware already restricts access
// to authenticated users.
type ScheduleCtxOk = {
  readonly ok: true
  readonly db: ReturnType<typeof getDb>
  readonly userId: string
}
type ScheduleCtxErr = {
  readonly ok: false
  readonly error: string
}
type ScheduleCtxResult = ScheduleCtxOk | ScheduleCtxErr

async function requireScheduleCtx(
  projectId: string,
  writeable?: boolean,
): Promise<ScheduleCtxResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "not authenticated" }
  if (writeable && isDemoUser(user.id)) {
    return { ok: false, error: "DEMO_READ_ONLY" }
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    return { ok: false, error: "Project not found" }
  }
  return { ok: true, db, userId: user.id }
}

// fetch workday exceptions for a project (typed)
async function fetchProjectExceptions(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<WorkdayExceptionData[]> {
  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))
  return rows.map((r) => ({
    ...r,
    category: r.category as ExceptionCategory,
    recurrence: r.recurrence as ExceptionRecurrence,
  }))
}

// load deps filtered to a project's tasks
async function fetchProjectDeps(
  db: ReturnType<typeof getDb>,
  projectId: string,
) {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  const allDeps = await db.select().from(taskDependencies)
  const taskIdSet = new Set(tasks.map((t) => t.id))
  const deps = allDeps.filter(
    (d) =>
      taskIdSet.has(d.predecessorId) &&
      taskIdSet.has(d.successorId),
  )
  return {
    tasks: tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
    })),
    deps: deps.map((d) => ({
      ...d,
      type: d.type as DependencyType,
    })),
  }
}

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
  /^\/dashboard\/contacts$/,
  /^\/dashboard\/customers$/,
  /^\/dashboard\/vendors$/,
  /^\/dashboard\/projects$/,
  /^\/dashboard\/projects\/[^/]+$/,
  /^\/dashboard\/projects\/[^/]+\/schedule$/,
  /^\/dashboard\/financials$/,
  /^\/dashboard\/people$/,
  /^\/dashboard\/files$/,
  /^\/dashboard\/files\/.+$/,
  /^\/dashboard\/boards\/[^/]+$/,
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
  const user = await getCurrentUser()
  if (!user?.organizationId) {
    return { error: "no organization context" }
  }
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const cap = input.limit ?? 20

  switch (input.queryType) {
    case "customers": {
      const rows = await db.query.customers.findMany({
        limit: cap,
        where: (c, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
          const conditions = [eqFunc(c.organizationId, orgId)]
          if (input.search) {
            conditions.push(likeFunc(c.name, `%${input.search}%`))
          }
          return conditions.length > 1 ? andFunc(...conditions) : conditions[0]
        },
      })
      return { data: rows, count: rows.length }
    }

    case "vendors": {
      const rows = await db.query.vendors.findMany({
        limit: cap,
        where: (v, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
          const conditions = [eqFunc(v.organizationId, orgId)]
          if (input.search) {
            conditions.push(likeFunc(v.name, `%${input.search}%`))
          }
          return conditions.length > 1 ? andFunc(...conditions) : conditions[0]
        },
      })
      return { data: rows, count: rows.length }
    }

    case "projects": {
      const rows = await db.query.projects.findMany({
        limit: cap,
        where: (p, { eq: eqFunc, like: likeFunc, and: andFunc }) => {
          const conditions = [eqFunc(p.organizationId, orgId)]
          if (input.search) {
            conditions.push(likeFunc(p.name, `%${input.search}%`))
          }
          return conditions.length > 1 ? andFunc(...conditions) : conditions[0]
        },
      })
      return { data: rows, count: rows.length }
    }

    case "invoices": {
      // join through projects to filter by org
      const rows = await db
        .select({
          id: invoices.id,
          netsuiteId: invoices.netsuiteId,
          customerId: invoices.customerId,
          projectId: invoices.projectId,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          subtotal: invoices.subtotal,
          tax: invoices.tax,
          total: invoices.total,
          amountPaid: invoices.amountPaid,
          amountDue: invoices.amountDue,
          memo: invoices.memo,
          lineItems: invoices.lineItems,
          createdAt: invoices.createdAt,
          updatedAt: invoices.updatedAt,
        })
        .from(invoices)
        .innerJoin(projects, eq(invoices.projectId, projects.id))
        .where(eq(projects.organizationId, orgId))
        .limit(cap)
      return { data: rows, count: rows.length }
    }

    case "vendor_bills": {
      // join through projects to filter by org
      const rows = await db
        .select({
          id: vendorBills.id,
          netsuiteId: vendorBills.netsuiteId,
          vendorId: vendorBills.vendorId,
          projectId: vendorBills.projectId,
          billNumber: vendorBills.billNumber,
          status: vendorBills.status,
          billDate: vendorBills.billDate,
          dueDate: vendorBills.dueDate,
          subtotal: vendorBills.subtotal,
          tax: vendorBills.tax,
          total: vendorBills.total,
          amountPaid: vendorBills.amountPaid,
          amountDue: vendorBills.amountDue,
          memo: vendorBills.memo,
          lineItems: vendorBills.lineItems,
          createdAt: vendorBills.createdAt,
          updatedAt: vendorBills.updatedAt,
        })
        .from(vendorBills)
        .innerJoin(projects, eq(vendorBills.projectId, projects.id))
        .where(eq(projects.organizationId, orgId))
        .limit(cap)
      return { data: rows, count: rows.length }
    }

    case "schedule_tasks": {
      // join through projects to filter by org
      const whereConditions = [eq(projects.organizationId, orgId)]
      if (input.search) {
        whereConditions.push(like(scheduleTasks.title, `%${input.search}%`))
      }
      const rows = await db
        .select({
          id: scheduleTasks.id,
          projectId: scheduleTasks.projectId,
          title: scheduleTasks.title,
          startDate: scheduleTasks.startDate,
          workdays: scheduleTasks.workdays,
          endDateCalculated: scheduleTasks.endDateCalculated,
          phase: scheduleTasks.phase,
          status: scheduleTasks.status,
          isCriticalPath: scheduleTasks.isCriticalPath,
          isMilestone: scheduleTasks.isMilestone,
          percentComplete: scheduleTasks.percentComplete,
          assignedTo: scheduleTasks.assignedTo,
          sortOrder: scheduleTasks.sortOrder,
          createdAt: scheduleTasks.createdAt,
          updatedAt: scheduleTasks.updatedAt,
        })
        .from(scheduleTasks)
        .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
        .where(whereConditions.length > 1 ? and(...whereConditions) : whereConditions[0])
        .limit(cap)
      return { data: rows, count: rows.length }
    }

    case "project_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.projects.findFirst({
        where: (p, { eq: eqFunc, and: andFunc }) =>
          andFunc(eqFunc(p.id, input.id!), eqFunc(p.organizationId, orgId)),
      })
      return row ? { data: row } : { error: "not found" }
    }

    case "customer_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.customers.findFirst({
        where: (c, { eq: eqFunc, and: andFunc }) =>
          andFunc(eqFunc(c.id, input.id!), eqFunc(c.organizationId, orgId)),
      })
      return row ? { data: row } : { error: "not found" }
    }

    case "vendor_detail": {
      if (!input.id) {
        return { error: "id required for detail query" }
      }
      const row = await db.query.vendors.findFirst({
        where: (v, { eq: eqFunc, and: andFunc }) =>
          andFunc(eqFunc(v.id, input.id!), eqFunc(v.organizationId, orgId)),
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
            "/dashboard/contacts, " +
            "/dashboard/financials, /dashboard/people, " +
            "/dashboard/files, /dashboard/boards/{id}",
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

  listThemes: tool({
    description:
      "List available visual themes (presets + user custom themes).",
    inputSchema: z.object({}),
    execute: async () => {
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }

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
  }),

  setTheme: tool({
    description:
      "Switch the user's visual theme. Use a preset ID " +
      "(native-compass, corpo, notebook, doom-64, bubblegum, " +
      "developers-choice, anslopics-clood, violet-bloom, soy, " +
      "mocha) or a custom theme UUID.",
    inputSchema: z.object({
      themeId: z.string().describe(
        "The theme ID to activate",
      ),
    }),
    execute: async (input: { themeId: string }) => {
      const result = await setUserThemePreference(input.themeId)
      if (!result.success) return { error: result.error }
      return {
        action: "apply_theme" as const,
        themeId: input.themeId,
      }
    },
  }),

  generateTheme: tool({
    description:
      "Generate and save a custom visual theme. Provide " +
      "complete light and dark color maps (all 32 keys), " +
      "fonts, optional Google Font names, and design tokens. " +
      "All colors must be in oklch() format.",
    inputSchema: z.object({
      name: z.string().describe("Theme display name"),
      description: z.string().describe("Brief theme description"),
      light: z.record(z.string(), z.string()).describe(
        "Light mode color map with all 32 ThemeColorKey entries",
      ),
      dark: z.record(z.string(), z.string()).describe(
        "Dark mode color map with all 32 ThemeColorKey entries",
      ),
      fonts: z.object({
        sans: z.string(),
        serif: z.string(),
        mono: z.string(),
      }).describe("CSS font-family strings"),
      googleFonts: z.array(z.string()).optional().describe(
        "Google Font names to load (case-sensitive)",
      ),
      radius: z.string().optional().describe(
        "Border radius (e.g. '0.5rem')",
      ),
      spacing: z.string().optional().describe(
        "Base spacing (e.g. '0.25rem')",
      ),
    }),
    execute: async (input: {
      name: string
      description: string
      light: Record<string, string>
      dark: Record<string, string>
      fonts: { sans: string; serif: string; mono: string }
      googleFonts?: ReadonlyArray<string>
      radius?: string
      spacing?: string
    }) => {
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }

      // build a full ThemeDefinition for storage
      const nativePreset = findPreset("native-compass")
      if (!nativePreset) return { error: "internal error" }

      const tokens: ThemeTokens = {
        radius: input.radius ?? "0.5rem",
        spacing: input.spacing ?? "0.25rem",
        trackingNormal: "0em",
        shadowColor: "#000000",
        shadowOpacity: "0.1",
        shadowBlur: "3px",
        shadowSpread: "0px",
        shadowOffsetX: "0",
        shadowOffsetY: "1px",
      }

      const defaultShadows: ThemeShadows = {
        "2xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
        xs: "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
        sm: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
        default: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
        md: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)",
        lg: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)",
        xl: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)",
        "2xl": "0 1px 3px 0px hsl(0 0% 0% / 0.25)",
      }

      const theme: ThemeDefinition = {
        id: "", // will be set by saveCustomTheme
        name: input.name,
        description: input.description,
        light: input.light as unknown as ColorMap,
        dark: input.dark as unknown as ColorMap,
        fonts: input.fonts as ThemeFonts,
        fontSources: {
          googleFonts: input.googleFonts ?? [],
        },
        tokens,
        shadows: { light: defaultShadows, dark: defaultShadows },
        isPreset: false,
        previewColors: {
          primary: input.light["primary"] ?? "oklch(0.5 0.1 200)",
          background: input.light["background"] ?? "oklch(0.97 0 0)",
          foreground: input.light["foreground"] ?? "oklch(0.2 0 0)",
        },
      }

      const saveResult = await saveCustomTheme(
        input.name,
        input.description,
        JSON.stringify(theme),
      )
      if (!saveResult.success) return { error: saveResult.error }

      const savedTheme = { ...theme, id: saveResult.id }

      return {
        action: "preview_theme" as const,
        themeId: saveResult.id,
        themeData: savedTheme,
      }
    },
  }),

  saveDashboard: tool({
    description:
      "Save the currently rendered UI as a named dashboard. " +
      "The client captures the current spec and data context " +
      "automatically. Returns an action for the client to " +
      "handle the save.",
    inputSchema: z.object({
      name: z.string().describe("Dashboard display name"),
      description: z.string().optional().describe(
        "Brief description of the dashboard",
      ),
      dashboardId: z.string().optional().describe(
        "Existing dashboard ID to update (for edits)",
      ),
    }),
    execute: async (input: {
      name: string
      description?: string
      dashboardId?: string
    }) => ({
      action: "save_dashboard" as const,
      name: input.name,
      description: input.description ?? "",
      dashboardId: input.dashboardId,
    }),
  }),

  listDashboards: tool({
    description:
      "List the user's saved custom dashboards.",
    inputSchema: z.object({}),
    execute: async () => {
      const result = await getCustomDashboards()
      if (!result.success) return { error: result.error }
      return {
        dashboards: result.data,
        count: result.data.length,
      }
    },
  }),

  editDashboard: tool({
    description:
      "Load a saved dashboard for editing. The client " +
      "injects the spec into the render context and " +
      "navigates to /dashboard. Optionally pass an " +
      "editPrompt to trigger immediate re-generation.",
    inputSchema: z.object({
      dashboardId: z.string().describe(
        "ID of the dashboard to edit",
      ),
      editPrompt: z.string().optional().describe(
        "Description of changes to make",
      ),
    }),
    execute: async (input: {
      dashboardId: string
      editPrompt?: string
    }) => {
      const result = await getCustomDashboardById(
        input.dashboardId,
      )
      if (!result.success) return { error: result.error }

      return {
        action: "load_dashboard" as const,
        dashboardId: input.dashboardId,
        spec: JSON.parse(result.data.specData),
        queries: result.data.queries,
        renderPrompt: result.data.renderPrompt,
        editPrompt: input.editPrompt,
      }
    },
  }),

  deleteDashboard: tool({
    description:
      "Delete a saved dashboard. Always confirm with " +
      "the user before deleting.",
    inputSchema: z.object({
      dashboardId: z.string().describe(
        "ID of the dashboard to delete",
      ),
    }),
    execute: async (input: { dashboardId: string }) => {
      const result = await deleteCustomDashboard(
        input.dashboardId,
      )
      if (!result.success) return { error: result.error }
      return {
        action: "toast" as const,
        message: "Dashboard deleted",
        type: "success",
      }
    },
  }),

  editTheme: tool({
    description:
      "Edit an existing custom theme. Provide the theme ID " +
      "and only the properties you want to change. " +
      "Unspecified properties are preserved from the " +
      "existing theme. Only works on custom themes " +
      "(not presets).",
    inputSchema: z.object({
      themeId: z.string().describe(
        "ID of existing custom theme to edit",
      ),
      name: z.string().optional().describe(
        "New display name",
      ),
      description: z.string().optional().describe(
        "New description",
      ),
      light: z.record(z.string(), z.string()).optional()
        .describe(
          "Partial light color overrides " +
          "(only changed keys)",
        ),
      dark: z.record(z.string(), z.string()).optional()
        .describe(
          "Partial dark color overrides " +
          "(only changed keys)",
        ),
      fonts: z.object({
        sans: z.string().optional(),
        serif: z.string().optional(),
        mono: z.string().optional(),
      }).optional().describe(
        "Partial font overrides",
      ),
      googleFonts: z.array(z.string()).optional()
        .describe("Replace Google Font list"),
      radius: z.string().optional().describe(
        "New border radius",
      ),
      spacing: z.string().optional().describe(
        "New base spacing",
      ),
    }),
    execute: async (input: {
      themeId: string
      name?: string
      description?: string
      light?: Record<string, string>
      dark?: Record<string, string>
      fonts?: {
        sans?: string
        serif?: string
        mono?: string
      }
      googleFonts?: ReadonlyArray<string>
      radius?: string
      spacing?: string
    }) => {
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }

      const existing = await getCustomThemeById(input.themeId)
      if (!existing.success) {
        return { error: existing.error }
      }

      const prev = JSON.parse(
        existing.data.themeData,
      ) as ThemeDefinition

      const mergedLight = input.light
        ? ({ ...prev.light, ...input.light } as unknown as ColorMap)
        : prev.light
      const mergedDark = input.dark
        ? ({ ...prev.dark, ...input.dark } as unknown as ColorMap)
        : prev.dark
      const mergedFonts: ThemeFonts = input.fonts
        ? {
            sans: input.fonts.sans ?? prev.fonts.sans,
            serif: input.fonts.serif ?? prev.fonts.serif,
            mono: input.fonts.mono ?? prev.fonts.mono,
          }
        : prev.fonts
      const mergedTokens: ThemeTokens = {
        ...prev.tokens,
        ...(input.radius ? { radius: input.radius } : {}),
        ...(input.spacing ? { spacing: input.spacing } : {}),
      }
      const mergedFontSources = input.googleFonts
        ? { googleFonts: input.googleFonts }
        : prev.fontSources

      const name = input.name ?? existing.data.name
      const description =
        input.description ?? existing.data.description

      const merged: ThemeDefinition = {
        ...prev,
        id: input.themeId,
        name,
        description,
        light: mergedLight,
        dark: mergedDark,
        fonts: mergedFonts,
        fontSources: mergedFontSources,
        tokens: mergedTokens,
        previewColors: {
          primary: mergedLight.primary,
          background: mergedLight.background,
          foreground: mergedLight.foreground,
        },
      }

      const saveResult = await saveCustomTheme(
        name,
        description,
        JSON.stringify(merged),
        input.themeId,
      )
      if (!saveResult.success) {
        return { error: saveResult.error }
      }

      return {
        action: "preview_theme" as const,
        themeId: input.themeId,
        themeData: merged,
      }
    },
  }),

  getProjectSchedule: tool({
    description:
      "Get the full schedule for a project including tasks, " +
      "dependencies, workday exceptions, and a computed summary " +
      "(counts, overall %, critical path). Always call this " +
      "before making schedule mutations to resolve task names " +
      "to IDs.",
    inputSchema: z.object({
      projectId: z.string().describe("The project UUID"),
    }),
    execute: async (input: { projectId: string }) => {
      const ctx = await requireScheduleCtx(input.projectId)
      if (!ctx.ok) return { error: ctx.error }
      const { db } = ctx

      const { tasks: typedTasks, deps: typedDeps } =
        await fetchProjectDeps(db, input.projectId)
      const exceptions = await fetchProjectExceptions(
        db,
        input.projectId,
      )

      const total = typedTasks.length
      const completed = typedTasks.filter(
        (t) => t.status === "COMPLETE",
      ).length
      const inProgress = typedTasks.filter(
        (t) => t.status === "IN_PROGRESS",
      ).length
      const blocked = typedTasks.filter(
        (t) => t.status === "BLOCKED",
      ).length
      const overallPercent =
        total > 0
          ? Math.round(
              typedTasks.reduce(
                (sum, t) => sum + t.percentComplete,
                0,
              ) / total,
            )
          : 0
      const criticalPath = typedTasks
        .filter((t) => t.isCriticalPath)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          startDate: t.startDate,
          endDate: t.endDateCalculated,
        }))

      return {
        tasks: typedTasks,
        dependencies: typedDeps,
        exceptions,
        summary: {
          total,
          completed,
          inProgress,
          blocked,
          pending: total - completed - inProgress - blocked,
          overallPercent,
          criticalPath,
        },
      }
    },
  }),

  createScheduleTask: tool({
    description:
      "Create a new task on a project schedule. Returns a " +
      "toast confirmation. Dates are ISO format (YYYY-MM-DD).",
    inputSchema: z.object({
      projectId: z.string().describe("The project UUID"),
      title: z.string().describe("Task title"),
      startDate: z
        .string()
        .describe("Start date in YYYY-MM-DD format"),
      workdays: z
        .number()
        .describe("Duration in working days"),
      phase: z
        .string()
        .describe(
          "Construction phase (preconstruction, sitework, " +
            "foundation, framing, roofing, electrical, plumbing, " +
            "hvac, insulation, drywall, finish, landscaping, closeout)",
        ),
      isMilestone: z
        .boolean()
        .optional()
        .describe("Whether this is a milestone (0 workdays)"),
      percentComplete: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Initial percent complete (0-100)"),
      assignedTo: z
        .string()
        .optional()
        .describe("Name of the person assigned"),
    }),
    execute: async (input: {
      projectId: string
      title: string
      startDate: string
      workdays: number
      phase: string
      isMilestone?: boolean
      percentComplete?: number
      assignedTo?: string
    }) => {
      const ctx = await requireScheduleCtx(
        input.projectId,
        true,
      )
      if (!ctx.ok) return { error: ctx.error }
      const { db } = ctx

      const exceptions = await fetchProjectExceptions(
        db,
        input.projectId,
      )

      const endDate = calculateEndDate(
        input.startDate,
        input.workdays,
        exceptions,
      )
      const now = new Date().toISOString()

      const existing = await db
        .select({ sortOrder: scheduleTasks.sortOrder })
        .from(scheduleTasks)
        .where(eq(scheduleTasks.projectId, input.projectId))
        .orderBy(asc(scheduleTasks.sortOrder))

      const nextOrder =
        existing.length > 0
          ? existing[existing.length - 1].sortOrder + 1
          : 0

      const id = crypto.randomUUID()
      await db.insert(scheduleTasks).values({
        id,
        projectId: input.projectId,
        title: input.title,
        startDate: input.startDate,
        workdays: input.workdays,
        endDateCalculated: endDate,
        phase: input.phase,
        status: "PENDING",
        isCriticalPath: false,
        isMilestone: input.isMilestone ?? false,
        percentComplete: input.percentComplete ?? 0,
        assignedTo: input.assignedTo ?? null,
        sortOrder: nextOrder,
        createdAt: now,
        updatedAt: now,
      })

      await recalcCriticalPathDirect(db, input.projectId)
      revalidatePath(
        `/dashboard/projects/${input.projectId}/schedule`,
      )

      return {
        action: "toast" as const,
        message: `Task "${input.title}" created`,
        type: "success",
      }
    },
  }),

  updateScheduleTask: tool({
    description:
      "Update an existing schedule task. Provide only the " +
      "fields to change. Use getProjectSchedule first to " +
      "resolve task names to IDs.",
    inputSchema: z.object({
      taskId: z.string().describe("The task UUID"),
      title: z.string().optional().describe("New title"),
      startDate: z
        .string()
        .optional()
        .describe("New start date (YYYY-MM-DD)"),
      workdays: z
        .number()
        .optional()
        .describe("New duration in working days"),
      phase: z.string().optional().describe("New phase"),
      status: z
        .enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"])
        .optional()
        .describe("New status"),
      isMilestone: z
        .boolean()
        .optional()
        .describe("Set milestone flag"),
      percentComplete: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("New percent complete (0-100)"),
      assignedTo: z
        .string()
        .nullable()
        .optional()
        .describe("New assignee (null to unassign)"),
    }),
    execute: async (input: {
      taskId: string
      title?: string
      startDate?: string
      workdays?: number
      phase?: string
      status?: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED"
      isMilestone?: boolean
      percentComplete?: number
      assignedTo?: string | null
    }) => {
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }
      if (isDemoUser(user.id)) {
        return { error: "DEMO_READ_ONLY" }
      }
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)

      const [task] = await db
        .select()
        .from(scheduleTasks)
        .where(eq(scheduleTasks.id, input.taskId))
        .limit(1)

      if (!task) return { error: "Task not found" }

      const { taskId, status, ...fields } = input
      const hasFields = Object.keys(fields).length > 0

      if (hasFields) {
        const exceptions = await fetchProjectExceptions(
          db,
          task.projectId,
        )

        const startDate = fields.startDate ?? task.startDate
        const workdays = fields.workdays ?? task.workdays
        const endDate = calculateEndDate(
          startDate,
          workdays,
          exceptions,
        )

        await db
          .update(scheduleTasks)
          .set({
            ...(fields.title && { title: fields.title }),
            startDate,
            workdays,
            endDateCalculated: endDate,
            ...(fields.phase && { phase: fields.phase }),
            ...(fields.isMilestone !== undefined && {
              isMilestone: fields.isMilestone,
            }),
            ...(fields.percentComplete !== undefined && {
              percentComplete: fields.percentComplete,
            }),
            ...(fields.assignedTo !== undefined && {
              assignedTo: fields.assignedTo,
            }),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(scheduleTasks.id, taskId))

        // propagate date changes to downstream tasks
        const allTasks = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, task.projectId))
        const allDeps = await db
          .select()
          .from(taskDependencies)
        const taskIdSet = new Set(allTasks.map((t) => t.id))
        const projectDeps = allDeps
          .filter(
            (d) =>
              taskIdSet.has(d.predecessorId) &&
              taskIdSet.has(d.successorId),
          )
          .map((d) => ({
            ...d,
            type: d.type as DependencyType,
          }))

        const updatedTask = {
          ...task,
          status: task.status as TaskStatus,
          startDate,
          workdays,
          endDateCalculated: endDate,
        }
        const typedAll = allTasks.map((t) =>
          t.id === taskId
            ? updatedTask
            : { ...t, status: t.status as TaskStatus },
        )
        const { updatedTasks } = propagateDates(
          taskId,
          typedAll,
          projectDeps,
          exceptions,
        )

        for (const [id, dates] of updatedTasks) {
          await db
            .update(scheduleTasks)
            .set({
              startDate: dates.startDate,
              endDateCalculated: dates.endDateCalculated,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(scheduleTasks.id, id))
        }
      }

      if (status) {
        await db
          .update(scheduleTasks)
          .set({
            status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(scheduleTasks.id, taskId))
      }

      if (!hasFields && !status) {
        return { error: "No fields provided to update" }
      }

      await recalcCriticalPathDirect(db, task.projectId)
      revalidatePath(
        `/dashboard/projects/${task.projectId}/schedule`,
      )

      return {
        action: "toast" as const,
        message: "Task updated",
        type: "success",
      }
    },
  }),

  deleteScheduleTask: tool({
    description:
      "Delete a schedule task. Always confirm with the user " +
      "before deleting. This also removes any dependencies " +
      "involving the task.",
    inputSchema: z.object({
      taskId: z.string().describe("The task UUID to delete"),
    }),
    execute: async (input: { taskId: string }) => {
      const user = await getCurrentUser()
      if (!user) return { error: "not authenticated" }
      if (isDemoUser(user.id)) {
        return { error: "DEMO_READ_ONLY" }
      }
      const { env } = await getCloudflareContext()
      const db = getDb(env.DB)

      const [task] = await db
        .select()
        .from(scheduleTasks)
        .where(eq(scheduleTasks.id, input.taskId))
        .limit(1)

      if (!task) return { error: "Task not found" }

      await db
        .delete(scheduleTasks)
        .where(eq(scheduleTasks.id, input.taskId))
      await recalcCriticalPathDirect(db, task.projectId)
      revalidatePath(
        `/dashboard/projects/${task.projectId}/schedule`,
      )

      return {
        action: "toast" as const,
        message: "Task deleted",
        type: "success",
      }
    },
  }),

  createScheduleDependency: tool({
    description:
      "Create a dependency between two tasks. Has built-in " +
      "cycle detection. Use getProjectSchedule first to " +
      "resolve task names to IDs.",
    inputSchema: z.object({
      projectId: z
        .string()
        .describe("The project UUID"),
      predecessorId: z
        .string()
        .describe("UUID of the predecessor task"),
      successorId: z
        .string()
        .describe("UUID of the successor task"),
      type: z
        .enum(["FS", "SS", "FF", "SF"])
        .describe(
          "Dependency type: FS (finish-to-start), " +
            "SS (start-to-start), FF (finish-to-finish), " +
            "SF (start-to-finish)",
        ),
      lagDays: z
        .number()
        .optional()
        .describe("Lag in working days (default 0)"),
    }),
    execute: async (input: {
      projectId: string
      predecessorId: string
      successorId: string
      type: "FS" | "SS" | "FF" | "SF"
      lagDays?: number
    }) => {
      const ctx = await requireScheduleCtx(
        input.projectId,
        true,
      )
      if (!ctx.ok) return { error: ctx.error }
      const { db } = ctx

      // load schedule for cycle check + propagation
      const { tasks: typedTasks, deps: existingDeps } =
        await fetchProjectDeps(db, input.projectId)

      if (
        wouldCreateCycle(
          existingDeps,
          input.predecessorId,
          input.successorId,
        )
      ) {
        return {
          error: "This dependency would create a cycle",
        }
      }

      const depId = crypto.randomUUID()
      await db.insert(taskDependencies).values({
        id: depId,
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type,
        lagDays: input.lagDays ?? 0,
      })

      // propagate dates
      const exceptions = await fetchProjectExceptions(
        db,
        input.projectId,
      )

      const updatedDeps = [
        ...existingDeps,
        {
          id: depId,
          predecessorId: input.predecessorId,
          successorId: input.successorId,
          type: input.type as DependencyType,
          lagDays: input.lagDays ?? 0,
        },
      ]
      const { updatedTasks } = propagateDates(
        input.predecessorId,
        typedTasks,
        updatedDeps,
        exceptions,
      )

      for (const [id, dates] of updatedTasks) {
        await db
          .update(scheduleTasks)
          .set({
            startDate: dates.startDate,
            endDateCalculated: dates.endDateCalculated,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(scheduleTasks.id, id))
      }

      await recalcCriticalPathDirect(db, input.projectId)
      revalidatePath(
        `/dashboard/projects/${input.projectId}/schedule`,
      )

      return {
        action: "toast" as const,
        message: "Dependency created",
        type: "success",
      }
    },
  }),

  deleteScheduleDependency: tool({
    description:
      "Delete a dependency between tasks. Use " +
      "getProjectSchedule first to find the dependency ID.",
    inputSchema: z.object({
      dependencyId: z
        .string()
        .describe("The dependency UUID to delete"),
      projectId: z
        .string()
        .describe("The project UUID (for revalidation)"),
    }),
    execute: async (input: {
      dependencyId: string
      projectId: string
    }) => {
      const ctx = await requireScheduleCtx(
        input.projectId,
        true,
      )
      if (!ctx.ok) return { error: ctx.error }
      const { db } = ctx

      await db
        .delete(taskDependencies)
        .where(eq(taskDependencies.id, input.dependencyId))
      await recalcCriticalPathDirect(db, input.projectId)
      revalidatePath(
        `/dashboard/projects/${input.projectId}/schedule`,
      )

      return {
        action: "toast" as const,
        message: "Dependency removed",
        type: "success",
      }
    },
  }),
}

// recalculates critical path for a project (inline version
// that doesn't depend on server action auth context)
async function recalcCriticalPathDirect(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<void> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))

  const allDeps = await db.select().from(taskDependencies)
  const taskIdSet = new Set(tasks.map((t) => t.id))
  const projectDeps = allDeps.filter(
    (d) =>
      taskIdSet.has(d.predecessorId) &&
      taskIdSet.has(d.successorId),
  )

  const criticalSet = findCriticalPath(
    tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
    })),
    projectDeps.map((d) => ({
      ...d,
      type: d.type as DependencyType,
    })),
  )

  for (const task of tasks) {
    const isCritical = criticalSet.has(task.id)
    if (task.isCriticalPath !== isCritical) {
      await db
        .update(scheduleTasks)
        .set({ isCriticalPath: isCritical })
        .where(eq(scheduleTasks.id, task.id))
    }
  }
}
