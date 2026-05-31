import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const installSchema = z.object({
  source: z
    .string()
    .describe(
      "GitHub source path, e.g. 'cloudflare/skills/wrangler'"
    ),
})

const listSchema = z.object({})

const toggleSchema = z.object({
  pluginId: z
    .string()
    .describe("The plugin ID of the skill"),
  enabled: z
    .boolean()
    .describe("true to enable, false to disable"),
})

const uninstallSchema = z.object({
  pluginId: z
    .string()
    .describe("The plugin ID of the skill"),
})

export function skillTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "installSkill",
      description:
        "Install a skill from GitHub (skills.sh format). " +
        "Source format: owner/repo or owner/repo/skill-name. " +
        "Requires admin role. Always confirm with the user " +
        "what skill they want before installing.",
      input_schema: zodToJsonSchema(installSchema),
      run: async (input: unknown): Promise<string> => {
        const args = installSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/skills/install",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "listInstalledSkills",
      description:
        "List all installed agent skills with their status.",
      input_schema: zodToJsonSchema(listSchema),
      run: async (): Promise<string> => {
        const result = await dataSource.fetch(
          "/api/compass/skills/list"
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "toggleInstalledSkill",
      description: "Enable or disable an installed skill.",
      input_schema: zodToJsonSchema(toggleSchema),
      run: async (input: unknown): Promise<string> => {
        const args = toggleSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/skills/toggle",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "uninstallSkill",
      description:
        "Remove an installed skill permanently. Requires " +
        "admin role. Always confirm before uninstalling.",
      input_schema: zodToJsonSchema(uninstallSchema),
      run: async (input: unknown): Promise<string> => {
        const args = uninstallSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/skills/uninstall",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
