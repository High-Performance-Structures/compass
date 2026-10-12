import { getCloudflareContext } from "@/lib/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { getDb } from "@/db"
import { resolveAgentUser } from "@/lib/agent/agent-user"
import {
  getCustomThemeForUser,
  listCustomThemesForUser,
  saveCustomThemeForUser,
  setThemePreferenceForUser,
} from "@/lib/theme/user-themes"
import { revalidatePath } from "next/cache"
import { THEME_PRESETS, findPreset } from "@/lib/theme/presets"
import type {
  ThemeDefinition,
  ColorMap,
  ThemeFonts,
  ThemeTokens,
  ThemeShadows,
} from "@/lib/theme/types"

type ThemeAction = "list" | "set" | "generate" | "edit"

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  // The agent calls this route with a bearer token only, so the user comes
  // from the verified token rather than the (absent) session cookie.
  const db = getDb(env.DB)
  const user = await resolveAgentUser(db, auth)
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: { action: ThemeAction; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    switch (body.action) {
      case "list": {
        const presets = THEME_PRESETS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          isPreset: true,
        }))

        const customs = (
          await listCustomThemesForUser(db, user.id)
        ).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          isPreset: false,
        }))

        return new Response(
          JSON.stringify({ themes: [...presets, ...customs] }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "set": {
        const themeId = body.themeId as string
        if (!themeId) {
          return new Response(
            JSON.stringify({ error: "themeId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const result = await setThemePreferenceForUser(
          db,
          user.id,
          themeId,
        )
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        revalidatePath("/", "layout")
        return new Response(
          JSON.stringify({
            success: true,
            themeId,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "generate": {
        const name = body.name as string
        const description = body.description as string
        const light = body.light as Record<string, string>
        const dark = body.dark as Record<string, string>
        const fonts = body.fonts as { sans: string; serif: string; mono: string }
        const googleFonts = (body.googleFonts as string[]) ?? []
        const radius = (body.radius as string) ?? "0.5rem"
        const spacing = (body.spacing as string) ?? "0.25rem"

        if (!name || !description || !light || !dark || !fonts) {
          return new Response(
            JSON.stringify({ error: "Missing required fields" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const nativePreset = findPreset("native-compass")
        if (!nativePreset) {
          return new Response(
            JSON.stringify({ error: "Internal error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const tokens: ThemeTokens = {
          radius,
          spacing,
          trackingNormal: "0em",
          shadowColor: "#000000",
          shadowOpacity: "0.1",
          shadowBlur: "3px",
          shadowSpread: "0px",
          shadowOffsetX: "0",
          shadowOffsetY: "1px",
        }

        const defaultShadows: ThemeShadows = {
          "2xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
          xs: "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
          sm: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
          default:
            "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
          md: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)",
          lg: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)",
          xl: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)",
          "2xl": "0 1px 3px 0px hsl(0 0% 0% / 0.25)",
        }

        const theme: ThemeDefinition = {
          id: "",
          name,
          description,
          light: light as unknown as ColorMap,
          dark: dark as unknown as ColorMap,
          fonts: fonts as ThemeFonts,
          fontSources: {
            googleFonts,
          },
          tokens,
          shadows: { light: defaultShadows, dark: defaultShadows },
          isPreset: false,
          previewColors: {
            primary: light["primary"] ?? "oklch(0.5 0.1 200)",
            background: light["background"] ?? "oklch(0.97 0 0)",
            foreground: light["foreground"] ?? "oklch(0.2 0 0)",
          },
        }

        const saveResult = await saveCustomThemeForUser(db, user.id, {
          name,
          description,
          themeData: JSON.stringify(theme),
        })
        if (!saveResult.success) {
          return new Response(
            JSON.stringify({ error: saveResult.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const savedTheme = { ...theme, id: saveResult.id }

        revalidatePath("/", "layout")
        return new Response(
          JSON.stringify({
            success: true,
            themeId: saveResult.id,
            themeData: savedTheme,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "edit": {
        const themeId = body.themeId as string
        if (!themeId) {
          return new Response(
            JSON.stringify({ error: "themeId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const existing = await getCustomThemeForUser(db, user.id, themeId)
        if (!existing.success) {
          return new Response(
            JSON.stringify({ error: existing.error }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const prev = JSON.parse(
          existing.data.themeData,
        ) as ThemeDefinition

        const mergedLight = body.light
          ? ({
              ...prev.light,
              ...(body.light as Record<string, string>),
            } as unknown as ColorMap)
          : prev.light
        const mergedDark = body.dark
          ? ({
              ...prev.dark,
              ...(body.dark as Record<string, string>),
            } as unknown as ColorMap)
          : prev.dark
        const mergedFonts: ThemeFonts = body.fonts
          ? {
              sans:
                (body.fonts as { sans?: string }).sans ?? prev.fonts.sans,
              serif:
                (body.fonts as { serif?: string }).serif ??
                prev.fonts.serif,
              mono:
                (body.fonts as { mono?: string }).mono ?? prev.fonts.mono,
            }
          : prev.fonts
        const mergedTokens: ThemeTokens = {
          ...prev.tokens,
          ...(body.radius ? { radius: body.radius as string } : {}),
          ...(body.spacing ? { spacing: body.spacing as string } : {}),
        }
        const mergedFontSources = body.googleFonts
          ? { googleFonts: body.googleFonts as string[] }
          : prev.fontSources

        const name = (body.name as string) ?? existing.data.name
        const description =
          (body.description as string) ?? existing.data.description

        const merged: ThemeDefinition = {
          ...prev,
          id: themeId,
          name,
          description,
          light: mergedLight,
          dark: mergedDark,
          fonts: mergedFonts,
          fontSources: mergedFontSources,
          tokens: mergedTokens,
          previewColors: {
            primary: mergedLight.primary,
            background: mergedLight.background,
            foreground: mergedLight.foreground,
          },
        }

        const saveResult = await saveCustomThemeForUser(db, user.id, {
          name,
          description,
          themeData: JSON.stringify(merged),
          existingId: themeId,
        })
        if (!saveResult.success) {
          return new Response(
            JSON.stringify({ error: saveResult.error }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        revalidatePath("/", "layout")
        return new Response(
          JSON.stringify({
            success: true,
            themeId,
            themeData: merged,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("Themes endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
