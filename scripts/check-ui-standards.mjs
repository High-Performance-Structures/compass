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
