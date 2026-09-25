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

const collectTypeScriptFiles = (relativeDirectory) => {
  const absoluteDirectory = join(root, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      collectTypeScriptFiles(relativePath)
      continue
    }
    if (/\.(tsx?|mts|cts)$/.test(entry.name)) sourceFiles.push(relativePath)
  }
}

for (const directory of sourceDirectories) collectTypeScriptFiles(directory)

for (const relativePath of sourceFiles) {
  if (relativePath === "src/components/data-table-pagination.tsx") continue

  const source = read(relativePath)
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
