"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Check, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCompassTheme } from "@/components/theme-provider"
import { useAgentOptional } from "@/components/agent/chat-provider"
import { THEME_PRESETS } from "@/lib/theme/presets"
import { deleteCustomTheme } from "@/app/actions/themes"
import type { ThemeDefinition } from "@/lib/theme/types"

function ThemeCard({
  theme,
  isActive,
  onSelect,
  onDelete,
}: {
  readonly theme: ThemeDefinition
  readonly isActive: boolean
  readonly onSelect: (e: React.MouseEvent) => void
  readonly onDelete?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "relative flex flex-col gap-1.5 rounded-lg border p-3 " +
        "text-left transition-colors hover:bg-accent/50 " +
        (isActive
          ? "border-primary ring-1 ring-primary"
          : "border-border")
      }
    >
      {isActive && (
        <div className="absolute top-2 right-2 rounded-full bg-primary p-0.5">
          <Check className="h-3 w-3 text-primary-foreground" />
        </div>
      )}

      <div className="flex gap-1">
        {[
          theme.previewColors.primary,
          theme.previewColors.background,
          theme.previewColors.foreground,
        ].map((color, i) => (
          <div
            key={i}
            className="h-5 w-5 rounded-full border border-border/50"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium truncate">
          {theme.name}
        </span>
        {!theme.isPreset && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
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
          className={
            "absolute bottom-2 right-2 rounded p-1 " +
            "text-muted-foreground hover:text-destructive " +
            "hover:bg-destructive/10 transition-colors"
          }
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </button>
  )
}

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const {
    activeThemeId,
    setVisualTheme,
    customThemes,
    refreshCustomThemes,
  } = useCompassTheme()
  const panel = useAgentOptional()

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
    <>
      <div className="space-y-1.5">
        <Label htmlFor="color-mode" className="text-xs">
          Color mode
        </Label>
        <Select
          value={theme ?? "light"}
          onValueChange={setTheme}
        >
          <SelectTrigger id="color-mode" className="w-full h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label className="text-xs">Theme</Label>
        <div className="grid grid-cols-3 gap-2">
          {allThemes.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              isActive={activeThemeId === t.id}
              onSelect={(e) => handleSelectTheme(t.id, e)}
              onDelete={
                t.isPreset
                  ? undefined
                  : () => handleDeleteTheme(t.id)
              }
            />
          ))}
        </div>
      </div>

      <Separator />

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleCreateWithAI}
      >
        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
        Create with AI
      </Button>
    </>
  )
}
