import { z } from "zod/v4"
import type { DataSource } from "../types"
import type { ToolDef } from "./data"
import { zodToJsonSchema } from "./data"

const listThemesSchema = z.object({})

const setThemeSchema = z.object({
  themeId: z.string().describe("The theme ID to activate"),
})

const generateThemeSchema = z.object({
  name: z.string().describe("Theme display name"),
  description: z.string().describe("Brief theme description"),
  light: z
    .record(z.string(), z.string())
    .describe(
      "Light mode color map with all 32 ThemeColorKey entries"
    ),
  dark: z
    .record(z.string(), z.string())
    .describe(
      "Dark mode color map with all 32 ThemeColorKey entries"
    ),
  fonts: z
    .object({
      sans: z.string(),
      serif: z.string(),
      mono: z.string(),
    })
    .describe("CSS font-family strings"),
  googleFonts: z
    .array(z.string())
    .optional()
    .describe("Google Font names to load (case-sensitive)"),
  radius: z
    .string()
    .optional()
    .describe("Border radius (e.g. '0.5rem')"),
  spacing: z
    .string()
    .optional()
    .describe("Base spacing (e.g. '0.25rem')"),
})

const editThemeSchema = z.object({
  themeId: z
    .string()
    .describe("ID of existing custom theme to edit"),
  name: z.string().optional().describe("New display name"),
  description: z
    .string()
    .optional()
    .describe("New description"),
  light: z
    .record(z.string(), z.string())
    .optional()
    .describe("Partial light color overrides (only changed keys)"),
  dark: z
    .record(z.string(), z.string())
    .optional()
    .describe("Partial dark color overrides (only changed keys)"),
  fonts: z
    .object({
      sans: z.string().optional(),
      serif: z.string().optional(),
      mono: z.string().optional(),
    })
    .optional()
    .describe("Partial font overrides"),
  googleFonts: z
    .array(z.string())
    .optional()
    .describe("Replace Google Font list"),
  radius: z
    .string()
    .optional()
    .describe("New border radius"),
  spacing: z
    .string()
    .optional()
    .describe("New base spacing"),
})

export function themeTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "listThemes",
      description:
        "List available visual themes (presets + user custom " +
        "themes).",
      input_schema: zodToJsonSchema(listThemesSchema),
      run: async (): Promise<string> => {
        const result = await dataSource.fetch(
          "/api/compass/themes/list"
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "setTheme",
      description:
        "Switch the user's visual theme. Use a preset ID " +
        "(native-compass, corpo, notebook, doom-64, " +
        "bubblegum, developers-choice, anslopics-clood, " +
        "violet-bloom, soy, mocha) or a custom theme UUID.",
      input_schema: zodToJsonSchema(setThemeSchema),
      run: async (input: unknown): Promise<string> => {
        const args = setThemeSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/themes/set",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "generateTheme",
      description:
        "Generate and save a custom visual theme. Provide " +
        "complete light and dark color maps (all 32 keys), " +
        "fonts, optional Google Font names, and design tokens. " +
        "All colors must be in oklch() format.",
      input_schema: zodToJsonSchema(generateThemeSchema),
      run: async (input: unknown): Promise<string> => {
        const args = generateThemeSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/themes/generate",
          args
        )
        return JSON.stringify(result)
      },
    },

    {
      name: "editTheme",
      description:
        "Edit an existing custom theme. Provide the theme ID " +
        "and only the properties you want to change. " +
        "Unspecified properties are preserved from the existing " +
        "theme. Only works on custom themes (not presets).",
      input_schema: zodToJsonSchema(editThemeSchema),
      run: async (input: unknown): Promise<string> => {
        const args = editThemeSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/themes/edit",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}
