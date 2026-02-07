export type ThemeColorKey =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "destructive-foreground"
  | "border"
  | "input"
  | "ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring"

export type ColorMap = Readonly<Record<ThemeColorKey, string>>

export interface ThemeFonts {
  readonly sans: string
  readonly serif: string
  readonly mono: string
}

export interface ThemeTokens {
  readonly radius: string
  readonly spacing: string
  readonly trackingNormal: string
  readonly shadowColor: string
  readonly shadowOpacity: string
  readonly shadowBlur: string
  readonly shadowSpread: string
  readonly shadowOffsetX: string
  readonly shadowOffsetY: string
}

export interface ThemeShadows {
  readonly "2xs": string
  readonly xs: string
  readonly sm: string
  readonly default: string
  readonly md: string
  readonly lg: string
  readonly xl: string
  readonly "2xl": string
}

export interface ThemePreviewColors {
  readonly primary: string
  readonly background: string
  readonly foreground: string
}

export interface ThemeDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly light: ColorMap
  readonly dark: ColorMap
  readonly fonts: ThemeFonts
  readonly fontSources: {
    readonly googleFonts: ReadonlyArray<string>
  }
  readonly tokens: ThemeTokens
  readonly shadows: {
    readonly light: ThemeShadows
    readonly dark: ThemeShadows
  }
  readonly isPreset: boolean
  readonly previewColors: ThemePreviewColors
}
