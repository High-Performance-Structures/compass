import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { compassApi } from "./api-client"

export function themeTools(apiBaseUrl: string, authToken: string) {
  return [
    tool(
      "listThemes",
      "List available visual themes (presets + user custom themes).",
      {},
      async () => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/themes/list",
          authToken
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "setTheme",
      "Switch the user's visual theme. Use a preset ID (native-compass, corpo, notebook, doom-64, bubblegum, developers-choice, anslopics-clood, violet-bloom, soy, mocha) or a custom theme UUID.",
      {
        themeId: z.string().describe("The theme ID to activate"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/themes/set",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "generateTheme",
      "Generate and save a custom visual theme. Provide complete light and dark color maps (all 32 keys), fonts, optional Google Font names, and design tokens. All colors must be in oklch() format.",
      {
        name: z.string().describe("Theme display name"),
        description: z.string().describe("Brief theme description"),
        light: z.record(z.string(), z.string()).describe(
          "Light mode color map with all 32 ThemeColorKey entries"
        ),
        dark: z.record(z.string(), z.string()).describe(
          "Dark mode color map with all 32 ThemeColorKey entries"
        ),
        fonts: z.object({
          sans: z.string(),
          serif: z.string(),
          mono: z.string(),
        }).describe("CSS font-family strings"),
        googleFonts: z.array(z.string()).optional().describe(
          "Google Font names to load (case-sensitive)"
        ),
        radius: z.string().optional().describe("Border radius (e.g. '0.5rem')"),
        spacing: z.string().optional().describe("Base spacing (e.g. '0.25rem')"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/themes/generate",
          authToken,
          args
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        }
      }
    ),

    tool(
      "editTheme",
      "Edit an existing custom theme. Provide the theme ID and only the properties you want to change. Unspecified properties are preserved from the existing theme. Only works on custom themes (not presets).",
      {
        themeId: z.string().describe("ID of existing custom theme to edit"),
        name: z.string().optional().describe("New display name"),
        description: z.string().optional().describe("New description"),
        light: z.record(z.string(), z.string()).optional().describe(
          "Partial light color overrides (only changed keys)"
        ),
        dark: z.record(z.string(), z.string()).optional().describe(
          "Partial dark color overrides (only changed keys)"
        ),
        fonts: z.object({
          sans: z.string().optional(),
          serif: z.string().optional(),
          mono: z.string().optional(),
        }).optional().describe("Partial font overrides"),
        googleFonts: z.array(z.string()).optional().describe("Replace Google Font list"),
        radius: z.string().optional().describe("New border radius"),
        spacing: z.string().optional().describe("New base spacing"),
      },
      async (args) => {
        const result = await compassApi(
          apiBaseUrl,
          "/api/compass/themes/edit",
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
