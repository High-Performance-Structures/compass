import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const SOURCE_DIRECTORY = resolve(ROOT, "docs/help/guides")
const OUTPUT = resolve(ROOT, "src/lib/help/help-guides.generated.ts")
const APP_DIRECTORY = resolve(ROOT, "src/app")
const VALID_ROUTE_ROOTS = new Set(["dashboard", "preview"])
const REQUIRED_FIELDS = [
  "id",
  "featureId",
  "slug",
  "title",
  "summary",
  "contextSummary",
  "category",
  "tags",
  "audiences",
  "permissions",
  "routes",
  "owner",
  "lastReviewed",
]
const VALID_AUDIENCES = new Set([
  "staff",
  "owner",
  "subcontractor",
  "supplier",
  "guest",
])
const VALID_FEATURE_IDS = new Set([
  "project-hub",
  "project-contacts",
  "daily-logs",
  "project-photos",
  "schedule",
  "rfis",
  "finish-selections",
  "owner-updates",
  "financials",
  "conversations",
  "help-resources",
])
const VALID_RESOURCES = new Set([
  "project",
  "schedule",
  "budget",
  "changeorder",
  "document",
  "user",
  "organization",
  "team",
  "group",
  "customer",
  "vendor",
  "finance",
  "bill_submission",
  "agent",
  "channels",
  "help",
])
const VALID_ACTIONS = new Set([
  "create",
  "read",
  "update",
  "delete",
  "approve",
  "moderate",
])

function fail(message, sourcePath) {
  const location = sourcePath ? `${sourcePath}: ` : ""
  throw new Error(`${location}${message}`)
}

export function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`[\]{}-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseHelpMarkdown(raw, sourcePath = "help guide") {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!frontmatterMatch) fail("missing JSON frontmatter", sourcePath)

  let metadata
  try {
    metadata = JSON.parse(frontmatterMatch[1])
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON"
    fail(`invalid JSON frontmatter (${message})`, sourcePath)
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in metadata)) fail(`missing metadata field '${field}'`, sourcePath)
  }
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/.test(metadata.id)) {
    fail("id must use stable dot-separated lowercase segments", sourcePath)
  }
  if (!VALID_FEATURE_IDS.has(metadata.featureId)) {
    fail(`unknown permission feature '${metadata.featureId}'`, sourcePath)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug)) {
    fail("slug must be lowercase kebab-case", sourcePath)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.lastReviewed)) {
    fail("lastReviewed must use YYYY-MM-DD", sourcePath)
  }
  if (!Array.isArray(metadata.audiences) || metadata.audiences.length === 0) {
    fail("audiences must be a non-empty array", sourcePath)
  }
  for (const audience of metadata.audiences) {
    if (!VALID_AUDIENCES.has(audience)) fail(`unknown audience '${audience}'`, sourcePath)
  }
  for (const field of ["tags", "permissions", "routes"]) {
    if (!Array.isArray(metadata[field])) fail(`${field} must be an array`, sourcePath)
  }
  for (const permission of metadata.permissions) {
    const [resource, action, extra] = permission.split(":")
    if (extra || !VALID_RESOURCES.has(resource) || !VALID_ACTIONS.has(action)) {
      fail(`invalid permission '${permission}'`, sourcePath)
    }
  }

  const body = raw.slice(frontmatterMatch[0].length).trim()
  if (body.startsWith("# ")) {
    fail("put the article title in frontmatter; body must begin below it", sourcePath)
  }

  const headingPattern = /^## (.+?) \{#([a-z0-9]+(?:-[a-z0-9]+)*)}\s*$/gm
  const anchoredHeadingPattern = /^## .+? \{#[a-z0-9]+(?:-[a-z0-9]+)*}\s*$/
  const matches = [...body.matchAll(headingPattern)]
  if (matches.length === 0) fail("at least one explicit H2 anchor is required", sourcePath)

  const unanchoredHeading = body
    .split(/\r?\n/)
    .find((line) => line.startsWith("## ") && !anchoredHeadingPattern.test(line))
  if (unanchoredHeading) fail(`H2 is missing an explicit anchor: ${unanchoredHeading}`, sourcePath)

  const anchorIds = new Set()
  const sections = matches.map((match, index) => {
    const title = match[1].trim()
    const id = match[2]
    if (anchorIds.has(id)) fail(`duplicate section anchor '${id}'`, sourcePath)
    anchorIds.add(id)
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? body.length
    const content = body.slice(start, end).trim()
    const firstParagraph = content
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => plainText(paragraph))
      .find(Boolean)
    if (!firstParagraph) fail(`section '${id}' has no content`, sourcePath)
    return {
      id,
      topicId: `${metadata.id}.${id}`,
      title,
      summary: firstParagraph,
      content,
    }
  })

  const renderedContent = body.replace(headingPattern, "## $1")
  const searchText = plainText(
    [
      metadata.title,
      metadata.summary,
      metadata.contextSummary,
      metadata.tags.join(" "),
      renderedContent,
    ].join(" ")
  ).toLocaleLowerCase()
  const words = plainText(renderedContent).split(/\s+/).filter(Boolean).length

  return {
    ...metadata,
    sourcePath,
    content: renderedContent,
    searchText,
    sections,
    readingMinutes: Math.max(2, Math.ceil(words / 200)),
  }
}

export function validateHelpRoute(route, sourcePath = "help guide") {
  if (typeof route !== "string") fail("route must be a string", sourcePath)
  if (
    route !== route.trim() ||
    !route.startsWith("/") ||
    route.endsWith("/") ||
    /[?#\\\u0000-\u001f\u007f]/.test(route)
  ) {
    fail(`route must be a canonical application pathname: ${route}`, sourcePath)
  }

  const segments = route.slice(1).split("/")
  if (!VALID_ROUTE_ROOTS.has(segments[0])) {
    fail(`route must begin with /dashboard or /preview: ${route}`, sourcePath)
  }
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    fail(`route must be a canonical application pathname: ${route}`, sourcePath)
  }

  return route
}

function routeToPagePath(route) {
  return resolve(APP_DIRECTORY, `.${route}`, "page.tsx")
}

async function loadGuides(maxReviewAgeDays) {
  const filenames = (await readdir(SOURCE_DIRECTORY))
    .filter((filename) => filename.endsWith(".md"))
    .sort()
  const guides = []
  const ids = new Set()
  const slugs = new Set()
  const topicIds = new Set()

  for (const filename of filenames) {
    const absolutePath = resolve(SOURCE_DIRECTORY, filename)
    const sourcePath = relative(ROOT, absolutePath).replaceAll("\\", "/")
    const guide = parseHelpMarkdown(await readFile(absolutePath, "utf8"), sourcePath)
    if (maxReviewAgeDays !== null) {
      const reviewedAt = Date.parse(`${guide.lastReviewed}T00:00:00Z`)
      const ageDays = Math.floor((Date.now() - reviewedAt) / 86_400_000)
      if (ageDays > maxReviewAgeDays) {
        fail(
          `review is ${ageDays} days old (maximum ${maxReviewAgeDays}); verify the workflow and update lastReviewed`,
          sourcePath
        )
      }
      if (ageDays < -1) fail("lastReviewed cannot be in the future", sourcePath)
    }
    if (ids.has(guide.id)) fail(`duplicate guide id '${guide.id}'`, sourcePath)
    if (slugs.has(guide.slug)) fail(`duplicate guide slug '${guide.slug}'`, sourcePath)
    ids.add(guide.id)
    slugs.add(guide.slug)

    for (const section of guide.sections) {
      if (topicIds.has(section.topicId)) fail(`duplicate topic id '${section.topicId}'`, sourcePath)
      topicIds.add(section.topicId)
    }
    for (const route of guide.routes) {
      validateHelpRoute(route, sourcePath)
      try {
        const routeStats = await stat(routeToPagePath(route))
        if (!routeStats.isFile()) fail(`route has no page.tsx: ${route}`, sourcePath)
      } catch {
        fail(`route has no page.tsx: ${route}`, sourcePath)
      }
    }
    guides.push(guide)
  }

  if (guides.length < 12) fail(`expected at least 12 guides, found ${guides.length}`)
  return guides
}

function generatedModule(guides) {
  return `// Generated by scripts/generate-help-resources.mjs.\n// Edit docs/help/guides/*.md, then run: bun run help:generate\n\nimport type { HelpGuide } from "@/lib/help/types"\n\nexport const HELP_GUIDES: readonly HelpGuide[] = ${JSON.stringify(guides, null, 2)}\n`
}

async function main() {
  const maxAgeArgument = process.argv.find((argument) =>
    argument.startsWith("--max-review-age-days=")
  )
  const maxReviewAgeDays = maxAgeArgument
    ? Number(maxAgeArgument.split("=")[1])
    : null
  if (
    maxReviewAgeDays !== null &&
    (!Number.isInteger(maxReviewAgeDays) || maxReviewAgeDays < 1)
  ) {
    fail("--max-review-age-days must be a positive integer")
  }
  const guides = await loadGuides(maxReviewAgeDays)
  const output = generatedModule(guides)
  if (process.argv.includes("--check")) {
    const existing = await readFile(OUTPUT, "utf8").catch(() => "")
    if (existing !== output) {
      fail("generated help registry is stale; run bun run help:generate")
    }
    console.log(`Validated ${guides.length} help guides and generated registry`)
    return
  }

  await writeFile(OUTPUT, output, "utf8")
  console.log(`Generated ${guides.length} help guides at ${relative(ROOT, OUTPUT)}`)
}

if (import.meta.main) await main()
