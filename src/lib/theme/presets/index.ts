// Built-in theme presets: one file per theme in this folder, listed here in
// the order the theme picker shows them. To add a theme, copy one file,
// change its id and colours, and add it to THEME_PRESETS below.
import type { ThemeDefinition } from "../types"
import { nativeCompassTheme } from "./native-compass"
import { corpoTheme } from "./corpo"
import { notebookTheme } from "./notebook"
import { doom64Theme } from "./doom-64"
import { bubblegumTheme } from "./bubblegum"
import { developersChoiceTheme } from "./developers-choice"
import { anslopicsCloodTheme } from "./anslopics-clood"
import { violetBloomTheme } from "./violet-bloom"
import { soyTheme } from "./soy"
import { mochaTheme } from "./mocha"
import { warmLuxuryTheme } from "./warm-luxury"
import { blackWhiteTheme } from "./black-white"
import { tweeterTheme } from "./tweeter"
import { orangTheme } from "./orang"
import { catppuccinTheme } from "./catppuccin"
import { signetTheme } from "./signet"

export const DEFAULT_THEME_ID = "native-compass"

export const THEME_PRESETS: ReadonlyArray<ThemeDefinition> = [
  nativeCompassTheme,
  corpoTheme,
  notebookTheme,
  doom64Theme,
  bubblegumTheme,
  developersChoiceTheme,
  anslopicsCloodTheme,
  violetBloomTheme,
  soyTheme,
  mochaTheme,
  warmLuxuryTheme,
  blackWhiteTheme,
  tweeterTheme,
  orangTheme,
  catppuccinTheme,
  signetTheme,
]

export function findPreset(
  id: string,
): ThemeDefinition | undefined {
  return THEME_PRESETS.find((p) => p.id === id)
}
