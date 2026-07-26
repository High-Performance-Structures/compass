import { z } from "zod/v4"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const VALID_ROUTES: ReadonlyArray<RegExp> = [
  /^\/dashboard$/,
  /^\/dashboard\/contacts$/,
  /^\/dashboard\/customers$/,
  /^\/dashboard\/vendors$/,
  /^\/dashboard\/projects$/,
  /^\/dashboard\/projects\/[^/]+$/,
  /^\/dashboard\/projects\/[^/]+\/schedule$/,
  /^\/dashboard\/projects\/[^/]+\/daily-logs$/,
  /^\/dashboard\/projects\/[^/]+\/owner-updates$/,
  /^\/dashboard\/projects\/[^/]+\/owner-updates\/[^/]+$/,
  /^\/dashboard\/projects\/[^/]+\/rfis$/,
  /^\/dashboard\/projects\/[^/]+\/photos$/,
  /^\/dashboard\/financials$/,
  /^\/dashboard\/people$/,
  /^\/dashboard\/files$/,
  /^\/dashboard\/files\/.+$/,
  /^\/dashboard\/boards\/[^/]+$/,
  /^\/dashboard\/conversations$/,
  /^\/dashboard\/settings$/,
]

function isValidRoute(path: string): boolean {
  return VALID_ROUTES.some((r) => r.test(path))
}

function normalizePath(path: string): string {
  let p = path.trim()
  if (!p.startsWith("/dashboard")) {
    p = p.startsWith("/") ? `/dashboard${p}` : `/dashboard/${p}`
  }
  return p
}

const navigateSchema = z.object({
  path: z
    .string()
    .describe(
      "Page path, e.g. 'projects' or '/dashboard/projects'"
    ),
  reason: z
    .string()
    .optional()
    .describe("Brief explanation of why navigating"),
})

const notificationSchema = z.object({
  message: z.string().describe("The notification message"),
  type: z
    .enum(["default", "success", "error"])
    .optional()
    .describe("Notification style"),
})

const generateUISchema = z.object({
  description: z
    .string()
    .describe(
      "Layout and content description for the dashboard to " +
        "generate. Be specific about what components and data " +
        "to display."
    ),
  dataContext: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Data to include in the rendered UI. Pass query results here."
    ),
})

type NavigateInput = z.infer<typeof navigateSchema>
type NotificationInput = z.infer<typeof notificationSchema>
type GenerateUIInput = z.infer<typeof generateUISchema>

export function uiTools(): ToolDef[] {
  return [
    {
      name: "navigateTo",
      description:
        "Navigate the user to a page. Paths are relative to " +
        "/dashboard \u2014 e.g. pass 'projects' or " +
        "'/dashboard/projects'. Valid pages: projects, " +
        "projects/{id}, projects/{id}/schedule, contacts, " +
        "projects/{id}/daily-logs, projects/{id}/owner-updates, " +
        "projects/{id}/owner-updates/{updateId}, projects/{id}/rfis, " +
        "projects/{id}/photos, " +
        "customers, vendors, financials, people, files, " +
        "files/{path}, boards/{id}, conversations, settings.",
      input_schema: zodToJsonSchema(navigateSchema),
      run: async (input: unknown): Promise<string> => {
        const args = navigateSchema.parse(input) as NavigateInput
        const resolved = normalizePath(args.path)
        if (!isValidRoute(resolved)) {
          return JSON.stringify({
            error:
              `"${args.path}" (resolved to "${resolved}") ` +
              "is not a valid page. Valid: projects, " +
              "projects/{id}, contacts, financials, people, " +
              "files, boards/{id}",
          })
        }
        return JSON.stringify({
          action: "navigate",
          path: resolved,
          reason: args.reason ?? null,
        })
      },
    },

    {
      name: "showNotification",
      description:
        "Show a toast notification to the user. Use for " +
        "confirmations or important alerts.",
      input_schema: zodToJsonSchema(notificationSchema),
      run: async (input: unknown): Promise<string> => {
        const args = notificationSchema.parse(
          input
        ) as NotificationInput
        return JSON.stringify({
          action: "toast",
          message: args.message,
          type: args.type ?? "default",
        })
      },
    },

    {
      name: "generateUI",
      description:
        "Generate a rich interactive UI dashboard. Use when " +
        "the user wants to see structured data (tables, charts, " +
        "stats, forms). Always fetch data with queryData first, " +
        "then pass it here as dataContext.",
      input_schema: zodToJsonSchema(generateUISchema),
      run: async (input: unknown): Promise<string> => {
        const args = generateUISchema.parse(
          input
        ) as GenerateUIInput
        return JSON.stringify({
          action: "generateUI",
          renderPrompt: args.description,
          dataContext: args.dataContext ?? {},
        })
      },
    },
  ]
}
