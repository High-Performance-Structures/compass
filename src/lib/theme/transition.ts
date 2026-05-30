import type { ThemeDefinition } from "./types"
import { applyTheme, removeThemeOverride } from "./apply"

export function applyThemeAnimated(
  theme: ThemeDefinition | null,
  origin?: { x: number; y: number },
): void {
  void origin

  if (theme) {
    applyTheme(theme)
  } else {
    removeThemeOverride()
  }
}
