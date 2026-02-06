import { tool } from "ai"
import { z } from "zod/v4"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { saveMemory, searchMemories } from "@/lib/agent/memory"

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

const renderInputSchema = z.object({
  componentType: z.string().describe(
    "Component type from the catalog " +
      "(DataTable, Card, StatCard, InvoiceTable, etc)"
  ),
  props: z
    .record(z.string(), z.unknown())
    .describe("Component props matching the catalog schema"),
})

type RenderInput = z.infer<typeof renderInputSchema>

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
    execute: async (input: NavigateInput) => ({
      action: "navigate" as const,
      path: input.path,
      reason: input.reason ?? null,
    }),
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

  renderComponent: tool({
    description:
      "Render a UI component from the catalog. Use to " +
      "display structured data like tables, cards, or charts.",
    inputSchema: renderInputSchema,
    execute: async (input: RenderInput) => ({
      action: "render" as const,
      spec: {
        type: input.componentType,
        props: input.props,
      },
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
}
