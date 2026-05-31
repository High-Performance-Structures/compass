"use client"

import * as React from "react"
import { useTheme } from "@/components/theme-provider"
import { Check, Moon, RotateCcw, Sparkles, Sun, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useCompassTheme } from "@/components/theme-provider"
import { useAgentOptional } from "@/components/agent/chat-provider"
import { THEME_PRESETS } from "@/lib/theme/presets"
import { deleteCustomTheme } from "@/app/actions/themes"
import type { ThemeDefinition, ColorMap } from "@/lib/theme/types"

/**
 * Mini UI preview showing what the theme actually looks like.
 * Renders a tiny mockup: sidebar strip, background, primary accent,
 * foreground text lines.
 */
function ThemePreview({
  colors,
}: {
  readonly colors: ColorMap
}) {
  return (
    <div
      className="relative h-12 w-full overflow-hidden rounded-md"
      style={{ backgroundColor: colors.background }}
    >
      {/* sidebar strip */}
      <div
        className="absolute inset-y-0 left-0 w-5"
        style={{ backgroundColor: colors.sidebar }}
      >
        {/* sidebar dots */}
        <div className="mt-2 flex flex-col items-center gap-0.5">
          <div
            className="size-1 rounded-full"
            style={{
              backgroundColor: colors["sidebar-foreground"],
              opacity: 0.5,
            }}
          />
          <div
            className="size-1 rounded-full"
            style={{
              backgroundColor: colors["sidebar-accent"],
            }}
          />
          <div
            className="size-1 rounded-full"
            style={{
              backgroundColor: colors["sidebar-foreground"],
              opacity: 0.5,
            }}
          />
        </div>
      </div>

      {/* main content area */}
      <div className="ml-5 p-1.5">
        {/* primary accent bar */}
        <div
          className="mb-1 h-1 w-6 rounded-full"
          style={{ backgroundColor: colors.primary }}
        />
        {/* text lines */}
        <div
          className="mb-0.5 h-0.5 w-10 rounded-full"
          style={{
            backgroundColor: colors.foreground,
            opacity: 0.5,
          }}
        />
        <div
          className="mb-0.5 h-0.5 w-7 rounded-full"
          style={{
            backgroundColor: colors.foreground,
            opacity: 0.25,
          }}
        />
      </div>
    </div>
  )
}

function ThemeCard({
  theme,
  isActive,
  isDark,
  onSelect,
  onDelete,
}: {
  readonly theme: ThemeDefinition
  readonly isActive: boolean
  readonly isDark: boolean
  readonly onSelect: (e: React.MouseEvent) => void
  readonly onDelete?: () => void
}) {
  const colors = isDark ? theme.dark : theme.light

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden",
        "rounded-lg border text-left transition-all duration-150",
        "hover:border-muted-foreground/30",
        isActive
          ? "border-primary ring-1 ring-primary"
          : "border-border"
      )}
    >
      <ThemePreview colors={colors} />

      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {isActive && (
          <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
            <Check className="size-2.5 text-primary-foreground" />
          </div>
        )}
        <span
          className={cn(
            "truncate text-xs font-medium",
            isActive ? "text-primary" : "text-foreground"
          )}
        >
          {theme.name}
        </span>
        {!theme.isPreset && (
          <Badge
            variant="secondary"
            className="ml-auto shrink-0 text-[10px] px-1 py-0"
          >
            Custom
          </Badge>
        )}
      </div>

      {!theme.isPreset && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className={cn(
            "absolute top-1.5 right-1.5 rounded-md p-1",
            "bg-background/80 backdrop-blur-sm",
            "text-muted-foreground hover:text-destructive",
            "opacity-0 group-hover:opacity-100",
            "transition-opacity duration-100"
          )}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </button>
  )
}

export function AppearanceTab() {
  const { resolvedTheme, setTheme } = useTheme()
  const {
    activeThemeId,
    setVisualTheme,
    customThemes,
    refreshCustomThemes,
  } = useCompassTheme()
  const panel = useAgentOptional()

  const isDark = resolvedTheme === "dark"

  const [zoomLevel, setZoomLevel] = React.useState(1.0)

  // Load persisted zoom level on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("compass-zoom-level")
      if (stored) {
        const level = parseFloat(stored)
        if (!isNaN(level) && level >= 0.5 && level <= 2.0) {
          setZoomLevel(level)
        }
      }
    } catch {
      // localStorage not available
    }
  }, [])

  async function applyZoom(level: number): Promise<void> {
    const clamped = Math.min(2.0, Math.max(0.5, level))
    try {
      localStorage.setItem("compass-zoom-level", String(clamped))
    } catch {
      // localStorage not available
    }
    // Use Electron native webview zoom when available.
    if (window.compassDesktop) {
      try {
        await window.compassDesktop.window.setZoom(clamped)
        document.documentElement.style.fontSize = ""
        return
      } catch {
        // Desktop bridge is unavailable or denied; use CSS fallback.
      }
    }
    // Fallback: scale root font-size (slightly thicker icons but functional)
    document.documentElement.style.fontSize = `${clamped * 16}px`
  }

  function handleZoomChange(value: number[]): void {
    const level = value[0]
    if (level === undefined) return
    setZoomLevel(level)
    void applyZoom(level)
  }

  function handleZoomReset(): void {
    setZoomLevel(1.0)
    void applyZoom(1.0)
  }

  const allThemes = React.useMemo<ReadonlyArray<ThemeDefinition>>(
    () => [...THEME_PRESETS, ...customThemes],
    [customThemes],
  )

  async function handleSelectTheme(
    themeId: string,
    e: React.MouseEvent,
  ) {
    await setVisualTheme(themeId, {
      x: e.clientX,
      y: e.clientY,
    })
    const t = allThemes.find((t) => t.id === themeId)
    if (t) {
      toast.success(`Theme changed to ${t.name}`)
    }
  }

  async function handleDeleteTheme(themeId: string) {
    const result = await deleteCustomTheme(themeId)
    if (result.success) {
      await refreshCustomThemes()
      toast.success("Custom theme deleted")
    } else {
      toast.error(result.error)
    }
  }

  function handleCreateWithAI() {
    if (!panel) {
      toast.info("Open the AI chat to create a custom theme")
      return
    }
    panel.open()
  }

  return (
    <div className="space-y-6">
      {/* color mode toggle */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Color mode</p>
        <div className="inline-flex rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-sm transition-colors duration-100",
              !isDark
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sun className="size-3.5" />
            Light
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-sm transition-colors duration-100",
              isDark
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Moon className="size-3.5" />
            Dark
          </button>
        </div>
      </div>

      {/* ui scale */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">UI Scale</p>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-muted-foreground">
              {Math.round(zoomLevel * 100)}%
            </span>
            {zoomLevel !== 1.0 && (
              <button
                type="button"
                onClick={handleZoomReset}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            )}
          </div>
        </div>
        <Slider
          value={[zoomLevel]}
          onValueChange={handleZoomChange}
          min={0.5}
          max={2.0}
          step={0.1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>50%</span>
          <span>200%</span>
        </div>
      </div>

      {/* theme grid */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Theme</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {allThemes.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              isActive={activeThemeId === t.id}
              isDark={isDark}
              onSelect={(e) => handleSelectTheme(t.id, e)}
              onDelete={
                t.isPreset
                  ? undefined
                  : () => handleDeleteTheme(t.id)
              }
            />
          ))}

          {/* create with AI card */}
          <button
            type="button"
            onClick={handleCreateWithAI}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5",
              "rounded-lg border border-dashed",
              "py-4 text-muted-foreground",
              "transition-colors duration-100",
              "hover:border-primary/50 hover:text-foreground"
            )}
          >
            <Sparkles className="size-4" />
            <span className="text-xs font-medium">
              Create with AI
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
