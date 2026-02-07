"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ThemeDefinition } from "@/lib/theme/types"
import { applyTheme, removeThemeOverride } from "@/lib/theme/apply"
import { applyThemeAnimated } from "@/lib/theme/transition"
import {
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  findPreset,
} from "@/lib/theme/presets"
import {
  getUserThemePreference,
  setUserThemePreference,
  getCustomThemes,
} from "@/app/actions/themes"

const ID_KEY = "compass-active-theme"
const DATA_KEY = "compass-theme-data"

interface CompassThemeState {
  readonly activeThemeId: string
  readonly activeTheme: ThemeDefinition | null
  readonly setVisualTheme: (
    themeId: string,
    origin?: { x: number; y: number },
  ) => Promise<void>
  readonly previewTheme: (theme: ThemeDefinition) => void
  readonly cancelPreview: () => void
  readonly customThemes: ReadonlyArray<ThemeDefinition>
  readonly refreshCustomThemes: () => Promise<void>
}

const CompassThemeContext = React.createContext<
  CompassThemeState | null
>(null)

export function useCompassTheme(): CompassThemeState {
  const ctx = React.useContext(CompassThemeContext)
  if (!ctx) {
    throw new Error(
      "useCompassTheme must be used within ThemeProvider",
    )
  }
  return ctx
}

function resolveTheme(
  id: string,
  customs: ReadonlyArray<ThemeDefinition>,
): ThemeDefinition | null {
  return findPreset(id) ?? customs.find((c) => c.id === id) ?? null
}

function cacheTheme(id: string, theme: ThemeDefinition | null): void {
  localStorage.setItem(ID_KEY, id)
  if (theme && id !== DEFAULT_THEME_ID) {
    localStorage.setItem(DATA_KEY, JSON.stringify(theme))
  } else {
    localStorage.removeItem(DATA_KEY)
  }
}

function CompassThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [activeThemeId, setActiveThemeId] = React.useState(
    DEFAULT_THEME_ID,
  )
  const [customThemes, setCustomThemes] = React.useState<
    ReadonlyArray<ThemeDefinition>
  >([])
  const [previewing, setPreviewing] = React.useState(false)
  const savedIdRef = React.useRef(DEFAULT_THEME_ID)

  const activeTheme = React.useMemo(
    () => resolveTheme(activeThemeId, customThemes),
    [activeThemeId, customThemes],
  )

  // hydrate from localStorage (instant) then validate against DB
  React.useLayoutEffect(() => {
    const cachedId = localStorage.getItem(ID_KEY)
    if (!cachedId || cachedId === DEFAULT_THEME_ID) return

    // try preset first (no async needed)
    const preset = findPreset(cachedId)
    if (preset) {
      applyTheme(preset)
      setActiveThemeId(cachedId)
      savedIdRef.current = cachedId
      return
    }

    // for custom themes, use cached theme data for instant apply
    const cachedData = localStorage.getItem(DATA_KEY)
    if (cachedData) {
      try {
        const theme = JSON.parse(cachedData) as ThemeDefinition
        applyTheme(theme)
        setActiveThemeId(cachedId)
        savedIdRef.current = cachedId
      } catch {
        // corrupted cache, clear it
        localStorage.removeItem(DATA_KEY)
      }
    }
  }, [])

  // fetch DB preference + custom themes to validate/sync
  React.useEffect(() => {
    Promise.all([getUserThemePreference(), getCustomThemes()])
      .then(([prefResult, customResult]) => {
        let customs: ReadonlyArray<ThemeDefinition> = []
        if (customResult.success) {
          customs = customResult.data.map((row) => ({
            ...(JSON.parse(row.themeData) as ThemeDefinition),
            id: row.id,
            name: row.name,
            description: row.description,
            isPreset: false,
          }))
          setCustomThemes(customs)
        }

        if (prefResult.success) {
          const dbId = prefResult.data.activeThemeId
          const currentId = savedIdRef.current

          // only re-apply if the DB disagrees with what we
          // already applied from cache
          if (dbId !== currentId) {
            savedIdRef.current = dbId
            setActiveThemeId(dbId)
            cacheTheme(
              dbId,
              dbId === DEFAULT_THEME_ID
                ? null
                : resolveTheme(dbId, customs),
            )

            if (dbId === DEFAULT_THEME_ID) {
              removeThemeOverride()
            } else {
              const theme = resolveTheme(dbId, customs)
              if (theme) applyTheme(theme)
            }
          } else {
            // IDs match, just make sure cache has latest data
            const theme = resolveTheme(dbId, customs)
            cacheTheme(dbId, theme)
          }
        }
      })
      .catch(() => {
        // silently fall back to whatever is cached
      })
  }, [])

  const setVisualTheme = React.useCallback(
    async (
      themeId: string,
      origin?: { x: number; y: number },
    ) => {
      setPreviewing(false)

      const theme =
        themeId === DEFAULT_THEME_ID
          ? null
          : resolveTheme(themeId, customThemes)

      applyThemeAnimated(theme, origin)
      setActiveThemeId(themeId)
      savedIdRef.current = themeId
      cacheTheme(themeId, theme)
      await setUserThemePreference(themeId)
    },
    [customThemes],
  )

  const previewTheme = React.useCallback(
    (theme: ThemeDefinition) => {
      setPreviewing(true)
      setActiveThemeId(theme.id)
      applyTheme(theme)
    },
    [],
  )

  const cancelPreview = React.useCallback(() => {
    if (!previewing) return
    setPreviewing(false)
    const id = savedIdRef.current
    setActiveThemeId(id)
    if (id === DEFAULT_THEME_ID) {
      removeThemeOverride()
    } else {
      const theme = resolveTheme(id, customThemes)
      if (theme) applyTheme(theme)
    }
  }, [previewing, customThemes])

  const refreshCustomThemes = React.useCallback(async () => {
    const result = await getCustomThemes()
    if (result.success) {
      const customs = result.data.map((row) => ({
        ...(JSON.parse(row.themeData) as ThemeDefinition),
        id: row.id,
        name: row.name,
        description: row.description,
        isPreset: false,
      }))
      setCustomThemes(customs)
    }
  }, [])

  // listen for agent CustomEvents
  React.useEffect(() => {
    function onApplyTheme(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { themeId?: string }
        | undefined
      if (detail?.themeId) {
        setVisualTheme(detail.themeId)
      }
    }

    function onPreviewTheme(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { themeId?: string; themeData?: ThemeDefinition }
        | undefined
      if (detail?.themeData) {
        refreshCustomThemes().then(() => {
          previewTheme(detail.themeData as ThemeDefinition)
        })
      } else if (detail?.themeId) {
        const theme = resolveTheme(detail.themeId, customThemes)
        if (theme) previewTheme(theme)
      }
    }

    window.addEventListener("agent-apply-theme", onApplyTheme)
    window.addEventListener("agent-preview-theme", onPreviewTheme)

    return () => {
      window.removeEventListener("agent-apply-theme", onApplyTheme)
      window.removeEventListener(
        "agent-preview-theme",
        onPreviewTheme,
      )
    }
  }, [
    setVisualTheme,
    previewTheme,
    refreshCustomThemes,
    customThemes,
  ])

  const value = React.useMemo<CompassThemeState>(
    () => ({
      activeThemeId,
      activeTheme,
      setVisualTheme,
      previewTheme,
      cancelPreview,
      customThemes,
      refreshCustomThemes,
    }),
    [
      activeThemeId,
      activeTheme,
      setVisualTheme,
      previewTheme,
      cancelPreview,
      customThemes,
      refreshCustomThemes,
    ],
  )

  return (
    <CompassThemeContext.Provider value={value}>
      {children}
    </CompassThemeContext.Provider>
  )
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <CompassThemeProvider>
      <NextThemesProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
      >
        {children}
      </NextThemesProvider>
    </CompassThemeProvider>
  )
}
