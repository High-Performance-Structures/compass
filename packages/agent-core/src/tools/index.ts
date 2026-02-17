import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { dataTools } from "./data"
import { uiTools } from "./ui"
import { scheduleTools } from "./schedule"
import { themeTools } from "./theme"
import { memoryTools } from "./memory"
import { skillTools } from "./skills"
import { githubTools } from "./github"
import { dashboardTools } from "./dashboards"

export type { ToolDef } from "./data"
export { zodToJsonSchema } from "./data"

export function createTools(dataSource: DataSource): ToolDef[] {
  return [
    ...dataTools(dataSource),
    ...uiTools(),
    ...scheduleTools(dataSource),
    ...themeTools(dataSource),
    ...memoryTools(dataSource),
    ...skillTools(dataSource),
    ...githubTools(dataSource),
    ...dashboardTools(dataSource),
  ]
}
