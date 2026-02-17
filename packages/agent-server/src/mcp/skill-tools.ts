import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function skillTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "installSkill",
      "Install a skill from GitHub (skills.sh format). Source format: owner/repo or owner/repo/skill-name. Requires admin role. Always confirm with the user what skill they want before installing.",
      {
        source: z.string().describe(
          "GitHub source path, e.g. 'cloudflare/skills/wrangler'"
        ),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/skills/install",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "listInstalledSkills",
      "List all installed agent skills with their status.",
      {},
      async () => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/skills/list",
          authToken
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "toggleInstalledSkill",
      "Enable or disable an installed skill.",
      {
        pluginId: z.string().describe("The plugin ID of the skill"),
        enabled: z.boolean().describe("true to enable, false to disable"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/skills/toggle",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "uninstallSkill",
      "Remove an installed skill permanently. Requires admin role. Always confirm before uninstalling.",
      {
        pluginId: z.string().describe("The plugin ID of the skill"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/skills/uninstall",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    )
  ]
}
