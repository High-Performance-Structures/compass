Theme System
===

Compass ships a runtime theming engine that lets users switch between preset palettes, create custom themes through the AI agent, and edit those themes incrementally. Every theme defines light and dark color maps, typography, spacing tokens, and shadow scales. Switching themes triggers an animated circle-reveal transition from the click origin.

This document explains how the pieces fit together, what problems the architecture solves, and where to look when something breaks.


How themes work
---

A theme is a `ThemeDefinition` object (defined in `src/lib/theme/types.ts`) containing:

- **32 color keys** for both light and dark modes (background, foreground, primary, sidebar variants, chart colors, etc.) - all in oklch() format
- **fonts** (sans, serif, mono) as CSS font-family strings, plus an optional list of Google Font names to load at runtime
- **tokens** for border radius, spacing, letter tracking, and shadow geometry
- **shadow scales** (2xs through 2xl) for both light and dark, since some themes use colored or offset shadows
- **preview colors** (primary, background, foreground) used by the theme card swatches in settings

When a theme is applied, `applyTheme()` in `src/lib/theme/apply.ts` builds a `<style>` block containing `:root { ... }` and `.dark { ... }` CSS variable declarations, then injects it into `<head>`. Because the style element has higher specificity than the default variables in `globals.css`, the theme overrides take effect immediately. Removing the style element reverts to the default "Native Compass" palette.

Google Fonts are loaded lazily. `loadGoogleFonts()` in `src/lib/theme/fonts.ts` tracks which fonts have already been injected and only adds new `<link>` elements for fonts not yet present. Fonts load with `display=swap` to avoid blocking rendering.


Presets vs custom themes
---

Preset themes are hardcoded in `src/lib/theme/presets.ts` and ship with the app. They're identified by slug IDs like `corpo`, `doom-64`, `violet-bloom`. The `findPreset()` function does a simple array lookup.

Custom themes live in the `custom_themes` D1 table (schema in `src/db/schema-theme.ts`). Each row stores the full `ThemeDefinition` as a JSON string in `theme_data`, scoped to a user via `user_id`. The user's active theme preference is stored separately in `user_theme_preference`.

This separation matters because preset resolution is synchronous (array lookup, no IO) while custom theme resolution requires a database fetch. The theme provider exploits this difference to eliminate flash-of-unstyled-content on page load.


Theme provider architecture
---

`ThemeProvider` in `src/components/theme-provider.tsx` wraps the entire app and manages theme state. It solves a specific problem: the user's chosen theme needs to be visible on the very first paint, before any server action can return data from D1.

The solution uses two localStorage keys:

- `compass-active-theme` stores the theme ID
- `compass-theme-data` stores the full theme JSON (only for non-default themes)

On mount, a `useLayoutEffect` reads both keys synchronously. For preset themes, it resolves the definition from the in-memory array. For custom themes, it parses the cached JSON. Either way, `applyTheme()` runs before the browser paints, so the user sees their chosen theme immediately.

A separate `useEffect` then fetches the user's actual preference from D1 and their custom themes list. If the database disagrees with what the cache applied (because the user changed themes on another device, say), it re-applies the correct theme. If they agree, it just refreshes the cached data to stay current.

This two-phase approach - instant from cache, then validate against the database - means theme application is never blocked on network IO.

The provider exposes these methods through `useCompassTheme()`:

- `setVisualTheme(themeId, origin?)` - commits a theme change. Triggers the circle-reveal animation, persists the preference to D1, and updates the cache.
- `previewTheme(theme)` - applies a theme instantly (no animation) without persisting. Used for hover previews and AI-generated theme previews.
- `cancelPreview()` - reverts to the committed theme. Also instant, no animation.
- `refreshCustomThemes()` - re-fetches the custom themes list from D1. Called after the agent creates or edits a theme.

The distinction between animated and instant application is intentional. The circle-reveal is satisfying when you deliberately choose a theme, but disorienting during previews or initial page loads. Only `setVisualTheme` animates.


Circle-reveal animation
---

`applyThemeAnimated()` in `src/lib/theme/transition.ts` wraps theme application in the View Transition API. The animation works like this:

1. `document.startViewTransition()` captures a screenshot of the current page
2. Inside the callback, CSS variables are mutated via `applyTheme()` or `removeThemeOverride()`
3. Once the new state is ready, we animate `::view-transition-new(root)` with an expanding `clip-path: circle()` from the click origin
4. The circle expands to cover the full viewport (radius calculated via `Math.hypot` from the origin to the farthest corner)

The animation runs for 400ms with `ease-in-out` easing. Two lines in `globals.css` disable the View Transition API's default crossfade so our clip-path animation is the only visual effect:

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
```

Fallback behavior: if the browser doesn't support the View Transition API (Firefox, older Safari) or the user has `prefers-reduced-motion: reduce` enabled, `applyThemeAnimated` skips the transition wrapper entirely and applies the theme instantly. No degraded experience, just no animation.

When themes are switched from the settings panel, the click coordinates come from the `MouseEvent` on the theme card. When the AI agent switches themes, no origin is provided, so the animation radiates from the viewport center.


AI agent integration
---

The agent has four theme-related tools defined in `src/lib/agent/tools.ts`:

**listThemes** returns all available themes (presets + user's custom themes) with IDs, names, and descriptions. The agent calls this when asked "what themes are available?" or needs to look up a theme by name.

**setTheme** activates a theme by ID. It persists the preference via `setUserThemePreference()`, then returns `{ action: "apply_theme", themeId }`. The chat adapter dispatches this as an `agent-apply-theme` CustomEvent, which the theme provider listens for and handles with `setVisualTheme()`.

**generateTheme** creates a new custom theme from scratch. The agent provides all 32 color keys for both light and dark modes, font stacks, optional Google Font names, and design tokens. The tool builds a full `ThemeDefinition`, saves it to D1 via `saveCustomTheme()`, and returns `{ action: "preview_theme", themeId, themeData }`. The chat adapter dispatches this as an `agent-preview-theme` CustomEvent, which triggers `refreshCustomThemes()` followed by `previewTheme()`.

**editTheme** modifies an existing custom theme. This is the incremental editing tool - the agent only provides the fields it wants to change. The tool fetches the existing theme from D1 via `getCustomThemeById()`, deep-merges the changes (spreading existing values under the new ones for colors, fonts, and tokens), rebuilds preview colors, saves the merged result back with the same ID, and returns the same `preview_theme` action shape.

The deep merge is straightforward: `{ ...existingLight, ...inputLight }` for color maps, individual key fallbacks for fonts (`input.fonts.sans ?? prev.fonts.sans`), and spread with conditional overrides for tokens. Only the keys the agent specifies are touched; everything else passes through unchanged.

The system prompt in `src/lib/agent/system-prompt.ts` includes guidance for when to use each tool:

- "change to corpo" -> setTheme
- "make me a sunset theme" -> generateTheme
- "make the primary darker" -> editTheme (when a custom theme is active)

The editTheme tool only works on custom themes, not presets. This is enforced by `getCustomThemeById()` which queries the `custom_themes` table scoped to the current user. If someone asks to tweak a preset, the agent should generate a new custom theme based on the preset's colors instead.


Server actions
---

Theme persistence is handled by server actions in `src/app/actions/themes.ts`:

- `getUserThemePreference()` - returns the user's active theme ID (defaults to "native-compass")
- `setUserThemePreference(themeId)` - validates the ID exists (as preset or custom theme belonging to user), then upserts into `user_theme_preference`
- `getCustomThemes()` - returns all custom themes for the current user, ordered by most recently updated
- `getCustomThemeById(themeId)` - fetches a single custom theme by ID, scoped to current user
- `saveCustomTheme(name, description, themeData, existingId?)` - creates or updates a custom theme. When `existingId` is provided, it updates the existing row instead of inserting
- `deleteCustomTheme(themeId)` - removes a custom theme and resets the user's preference to "native-compass" if it was the active theme

All actions follow the standard Compass pattern: authenticate via `getCurrentUser()`, return discriminated union results (`{ success: true, data }` or `{ success: false, error }`), and call `revalidatePath("/", "layout")` after mutations.


Database schema
---

Two tables in `src/db/schema-theme.ts`:

```
custom_themes
├── id           text (PK, UUID)
├── user_id      text (FK -> users.id, cascade delete)
├── name         text
├── description  text (default "")
├── theme_data   text (JSON-serialized ThemeDefinition)
├── created_at   text (ISO 8601)
└── updated_at   text (ISO 8601)

user_theme_preference
├── user_id          text (PK, FK -> users.id, cascade delete)
├── active_theme_id  text
└── updated_at       text (ISO 8601)
```

The `theme_data` column stores the complete `ThemeDefinition` as JSON. This means custom themes are self-contained - reading a single row gives you everything needed to apply the theme without any joins or additional queries.


File map
---

```
src/lib/theme/
├── types.ts        ThemeDefinition, ColorMap, and related types
├── presets.ts       THEME_PRESETS array + findPreset() + DEFAULT_THEME_ID
├── apply.ts         applyTheme() and removeThemeOverride() - CSS injection
├── transition.ts    applyThemeAnimated() - View Transition API wrapper
├── fonts.ts         loadGoogleFonts() - lazy Google Fonts injection
└── index.ts         barrel exports

src/components/
├── theme-provider.tsx         ThemeProvider + useCompassTheme hook
└── settings/appearance-tab.tsx  Theme cards UI + click-origin forwarding

src/app/actions/themes.ts       Server actions for D1 persistence
src/db/schema-theme.ts          Drizzle schema for theme tables
src/lib/agent/tools.ts          AI agent theme tools (lines 434-721)
src/lib/agent/system-prompt.ts  Theming guidance in buildThemingRules()
src/app/globals.css             Default theme vars + view-transition CSS
```


Adding a new preset
---

Add a `ThemeDefinition` object to the `THEME_PRESETS` array in `src/lib/theme/presets.ts`. The object needs all 32 color keys for both light and dark, plus fonts, tokens, shadows, and preview colors. Set `isPreset: true`.

Then update three references:
1. `setTheme` tool description in `tools.ts` - add the new ID to the preset list
2. `TOOL_REGISTRY` in `system-prompt.ts` - update the setTheme summary
3. `buildThemingRules()` in `system-prompt.ts` - add the new preset with a short description

All color values must be oklch() format. Light backgrounds should have lightness >= 0.90, dark backgrounds <= 0.25. Ensure sufficient contrast between foreground and background pairs.


Debugging
---

**Theme not applying on page load**: Check localStorage for `compass-active-theme` and `compass-theme-data`. If the ID points to a custom theme but the data key is missing or corrupted, the `useLayoutEffect` won't be able to apply it instantly. The DB fetch will eventually correct it, but there will be a flash.

**Circle animation not working**: The View Transition API requires Chromium 111+. Check `document.startViewTransition` exists. Also check that `prefers-reduced-motion` isn't set to `reduce` in OS settings or dev tools.

**Agent creates theme but it doesn't preview**: The tool should return `{ action: "preview_theme", themeId, themeData }`. The chat adapter dispatches this as a `CustomEvent` named `agent-preview-theme`. The theme provider listens for this event and calls `refreshCustomThemes()` then `previewTheme()`. Check the browser console for the event dispatch and verify the theme provider's event listener is registered.

**editTheme returns "theme not found"**: The tool only works on custom themes, not presets. `getCustomThemeById()` queries the `custom_themes` table scoped to the current user. If the theme ID is a preset slug or belongs to a different user, it will fail.
