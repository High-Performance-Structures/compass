import "server-only"

import type { AgentRouteHandler } from "@/lib/agent/in-process-data-source"
import { POST as dashboardsPOST } from "@/app/api/compass/dashboards/route"
import { POST as feedbackPOST } from "@/app/api/compass/feedback/route"
import { POST as githubPOST } from "@/app/api/compass/github/route"
import { POST as memoryPOST } from "@/app/api/compass/memory/route"
import { POST as messagesPOST } from "@/app/api/compass/messages/route"
import { POST as queryPOST } from "@/app/api/compass/query/route"
import { POST as schedulePOST } from "@/app/api/compass/schedule/route"
import { POST as skillsPOST } from "@/app/api/compass/skills/route"
import { POST as themesPOST } from "@/app/api/compass/themes/route"

/**
 * Agent tool API paths and the route handlers that serve them. The agent
 * runs these in-process (see src/lib/agent/in-process-data-source.ts); each
 * handler still validates the agent token and the user's permissions.
 */
export const AGENT_TOOL_ROUTES: ReadonlyMap<string, AgentRouteHandler> = new Map([
  ["/api/compass/dashboards", dashboardsPOST],
  ["/api/compass/feedback", feedbackPOST],
  ["/api/compass/github", githubPOST],
  ["/api/compass/memory", memoryPOST],
  ["/api/compass/messages", messagesPOST],
  ["/api/compass/query", queryPOST],
  ["/api/compass/schedule", schedulePOST],
  ["/api/compass/skills", skillsPOST],
  ["/api/compass/themes", themesPOST],
])
