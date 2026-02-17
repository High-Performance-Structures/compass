import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

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
  /^\/dashboard\/conversations$/,
  /^\/dashboard\/settings$/,
]

function isValidRoute(path: string): boolean {
  return VALID_ROUTES.some((r) => r.test(path))
}

/** Try to normalize a path to a valid dashboard route */
function normalizePath(path: string): string {
  let p = path.trim()
  // Strip leading/trailing slashes for normalization
  if (!p.startsWith("/dashboard")) {
    // Try prepending /dashboard
    p = p.startsWith("/") ? `/dashboard${p}` : `/dashboard/${p}`
  }
  return p
}

export function uiTools() {
  return [
    tool(
      "navigateTo",
      "Navigate the user to a page. Paths are relative to /dashboard — e.g. pass 'projects' or '/dashboard/projects'. Valid pages: projects, projects/{id}, projects/{id}/schedule, contacts, customers, vendors, financials, people, files, files/{path}, boards/{id}, conversations, settings.",
      {
        path: z.string().describe("Page path, e.g. 'projects' or '/dashboard/projects'"),
        reason: z.string().optional().describe("Brief explanation of why navigating"),
      },
      async (args) => {
        const resolved = normalizePath(args.path)
        if (!isValidRoute(resolved)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error:
                  `"${args.path}" (resolved to "${resolved}") is not a valid page. ` +
                  "Valid: projects, projects/{id}, contacts, " +
                  "financials, people, files, boards/{id}",
              })
            }]
          }
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "navigate",
              path: resolved,
              reason: args.reason ?? null,
            })
          }]
        }
      }
    ),

    tool(
      "showNotification",
      "Show a toast notification to the user. Use for confirmations or important alerts.",
      {
        message: z.string().describe("The notification message"),
        type: z.enum(["default", "success", "error"]).optional().describe("Notification style"),
      },
      async (args) => {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "toast",
              message: args.message,
              type: args.type ?? "default",
            })
          }]
        }
      }
    ),

    tool(
      "generateUI",
      "Generate a rich interactive UI dashboard. Use when the user wants to see structured data (tables, charts, stats, forms). Always fetch data with queryData first, then pass it here as dataContext.",
      {
        description: z.string().describe(
          "Layout and content description for the dashboard to generate. Be specific about what components and data to display."
        ),
        dataContext: z.record(z.string(), z.unknown()).optional().describe(
          "Data to include in the rendered UI. Pass query results here."
        ),
      },
      async (args) => {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "generateUI",
              renderPrompt: args.description,
              dataContext: args.dataContext ?? {},
            })
          }]
        }
      }
    )
  ]
}
