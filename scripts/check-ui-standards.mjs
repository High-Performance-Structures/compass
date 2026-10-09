import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const failures = []

const read = (relativePath) => {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`)
    return ""
  }
  return readFileSync(absolutePath, "utf8")
}

const standards = read("docs/development/ui-standards.md")
const agents = read("AGENTS.md")
const pullRequestTemplate = read(".github/pull_request_template.md")
const pagination = read("src/components/data-table-pagination.tsx")
const dialog = read("src/components/ui/dialog.tsx")
const alertDialog = read("src/components/ui/alert-dialog.tsx")
const scrollArea = read("src/components/ui/scroll-area.tsx")
const globalStyles = read("src/app/globals.css")

if (!standards.includes("## Scrolling and long content") || !standards.includes('type="auto"')) {
  failures.push("docs/development/ui-standards.md: must define visible scrollbars for long and growing content")
}

const nativeScrollbarDefaults = globalStyles.match(/(?:^|\n)\*\s*\{([^}]*)\}/)?.[1] ?? ""
if (!/scrollbar-width:\s*(thin|auto)\s*;/.test(nativeScrollbarDefaults)) {
  failures.push("src/app/globals.css: native scrollbars must be visible by default")
}

const webkitScrollbarDefaults = globalStyles.match(/(?:^|\n)\*::-webkit-scrollbar\s*\{([^}]*)\}/)?.[1] ?? ""
for (const dimension of ["width", "height"]) {
  if (!new RegExp(`${dimension}:\\s*[1-9][0-9]*(px|rem)\\s*;`).test(webkitScrollbarDefaults)) {
    failures.push(`src/app/globals.css: default scrollbars must have a visible ${dimension}`)
  }
}

if (!scrollArea.includes('type = "auto"') || !scrollArea.includes("type={type}")) {
  failures.push("src/components/ui/scroll-area.tsx: custom scrollbars must show by default when content overflows")
}

for (const section of ["## Theme tokens, density, and elevation", "## Typography", "## Page anatomy"]) {
  if (!standards.includes(section)) {
    failures.push(`docs/development/ui-standards.md: must define ${section.replace("## ", "")}`)
  }
}

// Density is a theme token; structural widths must not depend on it.
for (const [selector, block] of [
  [":root", globalStyles.match(/(?:^|\n):root\s*\{([^}]*)\}/)?.[1] ?? ""],
  [".dark", globalStyles.match(/(?:^|\n)\.dark\s*\{([^}]*)\}/)?.[1] ?? ""],
]) {
  if (!/--spacing:\s*0\.25rem\s*;/.test(block)) {
    failures.push(`src/app/globals.css: ${selector} must keep the 0.25rem density token`)
  }
}

if (!/25.*50.*100/.test(standards) || !/clamp/i.test(standards)) {
  failures.push(
    "docs/development/ui-standards.md: pagination standard must define page sizes and clamping",
  )
}

if (!agents.includes("docs/development/ui-standards.md")) {
  failures.push("AGENTS.md: must point to the canonical UI standards document")
}

if (!pullRequestTemplate.includes("UI standards review")) {
  failures.push(".github/pull_request_template.md: must include the UI standards review")
}

const dialogLayoutPatterns = [
  "fixed inset-0",
  "m-auto",
  "h-fit",
  "max-h-[calc(100dvh-2rem)]",
  "overflow-y-auto",
]

for (const [relativePath, source] of [
  ["src/components/ui/dialog.tsx", dialog],
  ["src/components/ui/alert-dialog.tsx", alertDialog],
]) {
  for (const pattern of dialogLayoutPatterns) {
    if (!source.includes(pattern)) {
      failures.push(`${relativePath}: shared dialog primitive is missing ${pattern}`)
    }
  }
}

if (
  !pagination.includes("TABLE_PAGE_SIZES = [25, 50, 100]") ||
  !pagination.includes("DEFAULT_TABLE_PAGE_SIZE") ||
  !pagination.includes("Items per page")
) {
  failures.push(
    "src/components/data-table-pagination.tsx: shared pagination must define the canonical controls",
  )
}

const smallTextExemptFiles = new Set([
  "src/app/dashboard/projects/[id]/purchase-orders/page.tsx",
  "src/components/desktop/sync-indicator.tsx",
  "src/components/help/help-compass-icon.tsx",
  "src/components/projects/daily-log-print-document.tsx",
  "src/components/projects/owner-update-document.tsx",
  "src/components/ui/badge-indicator.tsx",
  "src/components/ui/file-preview.tsx",
])

const stockColorExemptPrefixes = ["src/components/ai/", "src/app/print/"]
const stockColorExemptFiles = new Set([
  "src/components/files/file-icon.tsx",
  "src/components/voice/realtimekit-meeting-dialog.tsx",
  // The always-dark RealtimeKit meeting window intentionally owns its
  // provider-specific palette rather than using the app theme tokens.
  "src/components/voice/realtimekit-meeting-window.tsx",
])

const sourceDirectories = ["src/components", "src/app"]
const sourceFiles = []

const collectSourceFiles = (relativeDirectory) => {
  const absoluteDirectory = join(root, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(relativePath)
      continue
    }
    if (/\.(tsx?|mts|cts|css)$/.test(entry.name)) sourceFiles.push(relativePath)
  }
}

for (const directory of sourceDirectories) collectSourceFiles(directory)

for (const relativePath of sourceFiles) {
  if (relativePath === "src/components/data-table-pagination.tsx") continue

  const source = read(relativePath)
  // Radix suppresses its native viewport bar inside the dependency itself;
  // product styles must not hide the only visible scrollbar.
  const hidesScrollbar = /scrollbar-(?:hide|none)|\[scrollbar-width\s*:\s*none\]|\[&[^\]]*::-webkit-scrollbar[^\]]*\]:(?:hidden|w-0|h-0)|scrollbar-width\s*:\s*none|-ms-overflow-style\s*:\s*none|scrollbarWidth\s*:\s*["']none["']|::-webkit-scrollbar\s*\{[^}]*display\s*:\s*none/s
  if (hidesScrollbar.test(source)) {
    failures.push(`${relativePath}: product scrollbars must not be hidden`)
  }
  if (/<ScrollArea\b[^>]*\btype\s*=\s*["'](?:hover|scroll)["']/.test(source)) {
    failures.push(`${relativePath}: ScrollArea must reveal overflow without hover or scrolling`)
  }
  if (/<ScrollBar\b[^>]*className\s*=\s*["'][^"']*\bhidden\b/.test(source)) {
    failures.push(`${relativePath}: custom scrollbars must not be hidden`)
  }
  // Text under 12px is reserved for print layouts, glyphs inside icon-sized
  // count bubbles, avatar initials, and file thumbnails.
  if (!smallTextExemptFiles.has(relativePath) && !relativePath.startsWith("src/app/print/")) {
    source.split("\n").forEach((line, index) => {
      if (/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(line) && !line.includes("AvatarFallback")) {
        failures.push(`${relativePath}:${index + 1}: text must be at least 12px (use text-xs)`)
      }
    })
  }
  // Status and neutral colors come from theme tokens (destructive, warning,
  // success, info, muted). Stock palette colors are allowed only in vendored
  // AI elements, print layouts, file-type icons, and the always-dark call window.
  if (relativePath.endsWith(".tsx") && !stockColorExemptFiles.has(relativePath) && !stockColorExemptPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    source.split("\n").forEach((line, index) => {
      const stock = line.match(/(?<![\w:-])(?:(?:hover|focus|focus-visible|group-hover|dark):)*(?:bg|text|border|ring|fill|stroke|divide|outline|placeholder)-(?:red|rose|amber|yellow|orange|emerald|green|blue|sky|gray|neutral|zinc|slate|stone)-\d{2,3}\b/)
      if (stock) {
        failures.push(`${relativePath}:${index + 1}: use a theme token instead of ${stock[0]}`)
      }
    })
  }
  if (!source.includes("getPaginationRowModel")) continue

  const requiredPatterns = [
    "DataTablePagination",
    "DEFAULT_TABLE_PAGE_SIZE",
    "autoResetPageIndex: false",
    "onPaginationChange",
  ]

  for (const pattern of requiredPatterns) {
    if (!source.includes(pattern)) {
      failures.push(`${relativePath}: paginated table is missing ${pattern}`)
    }
  }

  if (!/pagination\s*(,|: pagination)/.test(source)) {
    failures.push(`${relativePath}: paginated table is missing controlled pagination state`)
  }
}

if (failures.length > 0) {
  console.error("UI standards check failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log("UI standards check passed")
}
