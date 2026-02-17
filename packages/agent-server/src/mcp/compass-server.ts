import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { dataTools } from "./data-tools"
import { uiTools } from "./ui-tools"
import { scheduleTools } from "./schedule-tools"
import { themeTools } from "./theme-tools"
import { memoryTools } from "./memory-tools"
import { skillTools } from "./skill-tools"
import { githubTools } from "./github-tools"
import { dashboardTools } from "./dashboard-tools"

/**
 * Create the Compass MCP server with all domain tools.
 *
 * @param apiBaseUrl - Base URL for the Compass Workers API (e.g., "https://compass.example.com")
 * @param authToken - JWT auth token for API requests
 * @returns MCP server instance
 */
export function createCompassMcpServer(apiBaseUrl: string, authToken: string) {
  return createSdkMcpServer({
    name: "compass",
    version: "1.0.0",
    tools: [
      ...dataTools(apiBaseUrl, authToken),
      ...uiTools(),
      ...scheduleTools(apiBaseUrl, authToken),
      ...themeTools(apiBaseUrl, authToken),
      ...memoryTools(apiBaseUrl, authToken),
      ...skillTools(apiBaseUrl, authToken),
      ...githubTools(apiBaseUrl, authToken),
      ...dashboardTools(apiBaseUrl, authToken),
    ]
  })
}
