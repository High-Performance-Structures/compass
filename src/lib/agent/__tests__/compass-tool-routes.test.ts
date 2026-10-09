import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createTools } from "agent-core"

// Minimal valid input for tools whose schemas have required fields. Tools
// not listed here accept an empty object.
const SAMPLE_INPUT: Readonly<Record<string, unknown>> = {
  queryData: { queryType: "projects" },
  editDashboard: { dashboardId: "dash-1" },
  deleteDashboard: { dashboardId: "dash-1" },
  saveDashboard: { name: "Ops", description: "", spec: {}, queries: [], renderPrompt: "" },
  setTheme: { themeId: "native-compass" },
  generateTheme: {
    name: "Test",
    description: "Test theme",
    light: {},
    dark: {},
    fonts: { sans: "Inter", serif: "Georgia", mono: "Menlo" },
  },
  editTheme: { themeId: "theme-1" },
  rememberContext: { content: "Prefers weekly summaries", memoryType: "preference" },
  recallMemory: { query: "summaries" },
  installSkill: { source: "owner/repo/skill" },
  toggleInstalledSkill: { pluginId: "skill-1", enabled: true },
  uninstallSkill: { pluginId: "skill-1" },
  queryGitHub: { queryType: "issues" },
  createGitHubIssue: { title: "Bug", body: "Details" },
  getProjectSchedule: { projectId: "project-1" },
  createScheduleTask: {
    projectId: "project-1",
    title: "Frame",
    startDate: "2026-10-12",
    workdays: 3,
    phase: "framing",
  },
  updateScheduleTask: { taskId: "task-1" },
  deleteScheduleTask: { taskId: "task-1" },
  createScheduleDependency: {
    projectId: "project-1",
    predecessorId: "task-1",
    successorId: "task-2",
    type: "FS",
  },
  deleteScheduleDependency: { dependencyId: "dep-1", projectId: "project-1" },
}

// These tools act in the browser (navigation, toasts, generated UI, saving a
// rendered dashboard) and never call the Compass API.
const CLIENT_SIDE_TOOLS: ReadonlySet<string> = new Set([
  "navigateTo",
  "showNotification",
  "generateUI",
  "saveDashboard",
])

function routeSource(path: string): string | null {
  const file = join(process.cwd(), "src/app", path, "route.ts")
  return existsSync(file) ? readFileSync(file, "utf8") : null
}

describe("built-in agent tools", () => {
  it("call an existing Compass API route with an action it handles", async () => {
    const calls: Array<{ readonly tool: string; readonly path: string; readonly body: unknown }> = []
    let current = ""
    const tools = createTools({
      async fetch(path: string, body?: unknown): Promise<unknown> {
        calls.push({ tool: current, path, body })
        return {}
      },
    })

    for (const tool of tools) {
      current = tool.name
      try {
        await tool.run(SAMPLE_INPUT[tool.name] ?? {})
      } catch {
        // Client-side tools may reject sample input; only API calls matter here.
      }
    }

    // A sample input that fails validation would skip a tool silently, so
    // every API-backed tool must have made its call.
    const calledTools = new Set(calls.map((call) => call.tool))
    const apiTools = tools
      .map((tool) => tool.name)
      .filter((name) => !CLIENT_SIDE_TOOLS.has(name))
    expect(apiTools.filter((name) => !calledTools.has(name))).toEqual([])

    for (const call of calls) {
      const source = routeSource(call.path)
      expect(source, `${call.tool} calls missing route ${call.path}`).not.toBeNull()

      // Every route except the query endpoint dispatches on body.action.
      if (call.path === "/api/compass/query") continue
      const action =
        typeof call.body === "object" && call.body !== null && "action" in call.body
          ? call.body.action
          : undefined
      expect(typeof action, `${call.tool} sends no action`).toBe("string")
      expect(source, `${call.tool} sends unhandled action ${String(action)}`).toContain(
        `case "${String(action)}"`,
      )
    }
  })
})
