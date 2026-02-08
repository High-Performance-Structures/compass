Theme System
===

Compass has a per-user theme system with 10 built-in presets and support for AI-generated custom themes. Users can switch themes instantly without page reload, and each user's preference persists independently.

The system lives in `src/lib/theme/` with four files: types, presets, apply, and fonts.


Why oklch
---

Every color in the theme system is defined in oklch format: `oklch(0.6671 0.0935 170.4436)`.

The choice of oklch over hex or hsl is deliberate. oklch is a perceptually uniform color space, which means that two colors with the same lightness value actually look equally bright to the human eye. In hsl, "50% lightness" for blue looks dramatically different from "50% lightness" for yellow. This matters when you're defining 32 color keys that need to feel visually consistent across different hues.

oklch has three components:
- **L** (0-1): perceptual lightness
- **C** (0-0.4ish): chroma (color intensity)
- **H** (0-360): hue angle

This makes it straightforward to create coherent dark/light mode pairs - you adjust the lightness channel while keeping hue and chroma consistent.


Color map
---

Each theme defines 32 color keys, once for light mode and once for dark. The `ThemeColorKey` type in `src/lib/theme/types.ts` enumerates all of them:

**Core UI colors** (16 keys):
- `background`, `foreground` - page background and default text
- `card`, `card-foreground` - card surfaces
- `popover`, `popover-foreground` - dropdown/dialog surfaces
- `primary`, `primary-foreground` - primary action color
- `secondary`, `secondary-foreground` - secondary actions
- `muted`, `muted-foreground` - subdued elements
- `accent`, `accent-foreground` - accent highlights
- `destructive`, `destructive-foreground` - danger/error states

**Utility colors** (3 keys):
- `border` - borders and dividers
- `input` - form input borders
- `ring` - focus ring color

**Chart colors** (5 keys):
- `chart-1` through `chart-5` - used by Recharts visualizations

**Sidebar colors** (8 keys):
- `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`

The sidebar has its own color set because it's often visually distinct from the main content area. The native-compass preset, for example, uses a teal sidebar against a warm off-white background.

The type is defined as:

```typescript
export type ColorMap = Readonly<Record<ThemeColorKey, string>>
```

Readonly because theme colors should never be mutated after creation.


Fonts
---

Each theme specifies three font stacks:

```typescript
export interface ThemeFonts {
  readonly sans: string
  readonly serif: string
  readonly mono: string
}
```

These map to CSS variables `--font-sans`, `--font-serif`, and `--font-mono` that Tailwind v4 picks up.

Themes can also declare Google Fonts to load dynamically:

```typescript
fontSources: { googleFonts: ["Oxanium", "Source Code Pro"] }
```

The `loadGoogleFonts()` function in `src/lib/theme/fonts.ts` handles this. It maintains a `Set<string>` of already-loaded fonts to avoid duplicate requests, constructs the Google Fonts CSS URL with weights 300-700, and injects a `<link>` element into the document head.

```typescript
const families = toLoad
  .map((f) => `family=${f.replace(/ /g, "+")}:wght@300;400;500;600;700`)
  .join("&")

const href =
  `https://fonts.googleapis.com/css2?${families}&display=swap`
```

The `display=swap` parameter ensures text remains visible while the font loads.


Design tokens
---

Beyond colors and fonts, each theme defines spatial and shadow tokens:

```typescript
export interface ThemeTokens {
  readonly radius: string      // border radius (e.g., "1.575rem")
  readonly spacing: string     // base spacing unit (e.g., "0.3rem")
  readonly trackingNormal: string  // letter spacing
  readonly shadowColor: string
  readonly shadowOpacity: string
  readonly shadowBlur: string
  readonly shadowSpread: string
  readonly shadowOffsetX: string
  readonly shadowOffsetY: string
}
```

Themes also define a full shadow scale from `2xs` to `2xl`, separately for light and dark modes. This allows themes to have fundamentally different shadow characters - doom-64 uses hard directional shadows while bubblegum uses pop-art style drop shadows.


How applyTheme() works
---

The core of the theme system is `applyTheme()` in `src/lib/theme/apply.ts`. It works by injecting a `<style>` element that overrides CSS custom properties:

```typescript
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
```

The approach is straightforward: build CSS strings for light and dark modes, find or create a `<style id="compass-theme-vars">` element, and set its content. Since these CSS variables are what Tailwind and shadcn components already reference, the entire UI updates instantly. No page reload, no React re-render cascade.

`removeThemeOverride()` removes the injected style element, reverting to whatever the base CSS defines.


Built-in presets
---

Ten presets are defined in `src/lib/theme/presets.ts`:

| ID | Name | Description |
|----|------|-------------|
| `native-compass` | Native Compass | The default teal-forward construction palette. Sora font. |
| `corpo` | Corpo | Clean, professional blue palette for corporate environments. |
| `notebook` | Notebook | Warm, handwritten feel with sketchy aesthetics. |
| `doom-64` | Doom 64 | Gritty, industrial palette with sharp edges and no mercy. Oxanium font, 0px border radius. |
| `bubblegum` | Bubblegum | Playful pink and pastel palette with pop art shadows. |
| `developers-choice` | Developer's Choice | Retro pixel-font terminal aesthetic in teal-grey tones. |
| `anslopics-clood` | Anslopics Clood | Warm amber-orange palette with clean corporate lines. |
| `violet-bloom` | Violet Bloom | Deep violet primary with elegant rounded corners and tight tracking. |
| `soy` | Soy | Rosy pink and magenta palette with warm romantic tones. |
| `mocha` | Mocha | Warm coffee-brown palette with cozy earthy tones and offset shadows. |

`native-compass` is the default when no preference is set. Each preset demonstrates different design personalities - doom-64 uses 0px radius for sharp industrial edges, while native-compass uses 1.575rem for soft rounded corners.

The `DEFAULT_THEME_ID` export and `findPreset()` helper make it easy to look up presets by ID.


Custom themes via AI
---

The AI agent can generate custom themes through tool calls. The theme tools defined in `src/lib/agent/tools.ts` allow the agent to:

- `listThemes` - list all presets and custom themes
- `setTheme` - switch the user's active theme
- `generateTheme` - create a new custom theme from a description
- `editTheme` - modify an existing custom theme

When the agent generates a theme, it produces a complete `ThemeDefinition` (all 32 color keys for both light and dark, fonts, tokens, shadows) and saves it via the `saveCustomTheme` server action.


Database tables
---

Two tables in `src/db/schema-theme.ts` persist theme data:

### custom_themes

Stores AI-generated or user-created themes.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | UUID |
| `user_id` | text (FK -> users) | Owner. Cascade delete. |
| `name` | text | Display name |
| `description` | text | Theme description |
| `theme_data` | text | Full ThemeDefinition as JSON |
| `created_at` | text | ISO 8601 timestamp |
| `updated_at` | text | ISO 8601 timestamp |

### user_theme_preference

Tracks which theme each user has active.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | text (PK, FK -> users) | One preference per user. Cascade delete. |
| `active_theme_id` | text | ID of active theme (preset or custom) |
| `updated_at` | text | ISO 8601 timestamp |


Server actions
---

Five actions in `src/app/actions/themes.ts`:

- `getUserThemePreference()` - returns the user's active theme ID, defaulting to `"native-compass"`
- `setUserThemePreference(themeId)` - validates the theme exists (as preset or custom), then upserts the preference
- `getCustomThemes()` - lists all custom themes for the current user
- `getCustomThemeById(themeId)` - fetches a single custom theme
- `saveCustomTheme(name, description, themeData, existingId?)` - creates or updates a custom theme
- `deleteCustomTheme(themeId)` - deletes a custom theme and resets the user's preference to native-compass if they were using it

All follow the standard server action pattern: auth check, discriminated union return, `revalidatePath("/", "layout")` after mutations. The `setUserThemePreference` action uses `onConflictDoUpdate` for upsert behavior since the preference table is keyed by user ID.
