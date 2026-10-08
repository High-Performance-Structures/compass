"use client"

import { useScheduleDisplayPreferences } from "@/hooks/use-schedule-display-preferences"
import type { DisplayColorPalette } from "@/lib/schedule/appearance"

export function useScheduleDisplayPalette(
  projectId: string
): DisplayColorPalette {
  return useScheduleDisplayPreferences(projectId).displayColorPalette
}
