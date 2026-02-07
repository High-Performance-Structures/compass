import type { ThemeDefinition, ThemeColorKey } from "./types"
import { loadGoogleFonts } from "./fonts"

const STYLE_ID = "compass-theme-vars"

const COLOR_KEYS: ReadonlyArray<ThemeColorKey> = [
  "background", "foreground", "card", "card-foreground",
  "popover", "popover-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "muted", "muted-foreground",
  "accent", "accent-foreground", "destructive", "destructive-foreground",
  "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "sidebar", "sidebar-foreground", "sidebar-primary",
  "sidebar-primary-foreground", "sidebar-accent",
  "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
]

function buildColorBlock(
  colors: Readonly<Record<ThemeColorKey, string>>,
): string {
  return COLOR_KEYS
    .map((key) => `  --${key}: ${colors[key]};`)
    .join("\n")
}

function buildTokenBlock(theme: ThemeDefinition): string {
  const t = theme.tokens
  return [
    `  --radius: ${t.radius};`,
    `  --spacing: ${t.spacing};`,
    `  --tracking-normal: ${t.trackingNormal};`,
    `  --shadow-color: ${t.shadowColor};`,
    `  --shadow-opacity: ${t.shadowOpacity};`,
    `  --shadow-blur: ${t.shadowBlur};`,
    `  --shadow-spread: ${t.shadowSpread};`,
    `  --shadow-offset-x: ${t.shadowOffsetX};`,
    `  --shadow-offset-y: ${t.shadowOffsetY};`,
    `  --font-sans: ${theme.fonts.sans};`,
    `  --font-serif: ${theme.fonts.serif};`,
    `  --font-mono: ${theme.fonts.mono};`,
  ].join("\n")
}

function buildShadowBlock(
  shadows: ThemeDefinition["shadows"]["light"],
): string {
  return [
    `  --shadow-2xs: ${shadows["2xs"]};`,
    `  --shadow-xs: ${shadows.xs};`,
    `  --shadow-sm: ${shadows.sm};`,
    `  --shadow: ${shadows.default};`,
    `  --shadow-md: ${shadows.md};`,
    `  --shadow-lg: ${shadows.lg};`,
    `  --shadow-xl: ${shadows.xl};`,
    `  --shadow-2xl: ${shadows["2xl"]};`,
  ].join("\n")
}

export function applyTheme(theme: ThemeDefinition): void {
  const lightCSS = [
    buildColorBlock(theme.light),
    buildTokenBlock(theme),
    buildShadowBlock(theme.shadows.light),
  ].join("\n")

  const darkCSS = [
    buildColorBlock(theme.dark),
    buildTokenBlock(theme),
    buildShadowBlock(theme.shadows.dark),
  ].join("\n")

  const css =
    `:root {\n${lightCSS}\n}\n.dark {\n${darkCSS}\n}`

  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement("style")
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = css

  if (theme.fontSources.googleFonts.length > 0) {
    loadGoogleFonts(theme.fontSources.googleFonts)
  }
}

export function removeThemeOverride(): void {
  const el = document.getElementById(STYLE_ID)
  if (el) el.remove()
}
