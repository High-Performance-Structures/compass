import type { HelpGuide } from "@/lib/help/types"

/*
 * Help comes to the browser in two sizes:
 *
 * - `HelpGuideListing`: titles, summaries, routes and section headings. The
 *   dashboard and preview layouts send this with every page so the Help
 *   drawer list, page suggestions and contextual beacons work instantly.
 * - `HelpGuidePreview`: the listing plus article text and search text. It is
 *   ~7x larger, so the drawer fetches it from `/api/help/guides` only when it
 *   opens (see `help-guide-details.ts`). The full Help page builds it on the
 *   server because that page always searches and shows articles.
 *
 * Both are built only from guides the server already allowed for the viewer.
 */

type HelpSectionListing = Readonly<{
  id: string
  topicId: string
  title: string
  summary: string
}>

export type HelpGuideListing = Readonly<{
  id: string
  slug: string
  title: string
  summary: string
  contextSummary: string
  category: string
  tags: readonly string[]
  routes: readonly string[]
  readingMinutes: number
  sections: readonly HelpSectionListing[]
}>

type HelpSectionPreview = HelpSectionListing &
  Readonly<{
    searchText: string
  }>

export type HelpGuidePreview = Omit<HelpGuideListing, "sections"> &
  Readonly<{
    content: string
    searchText: string
    sections: readonly HelpSectionPreview[]
  }>

export type HelpTopicPreview = Readonly<{
  topicId: string
  title: string
  summary: string
  href: string
}>

export type HelpGuidePreviewResult = Readonly<{
  guide: HelpGuidePreview
  href: string
  score: number
}>

const HELP_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "the",
  "this",
  "to",
  "use",
  "what",
  "where",
  "with",
])

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** The light shape every dashboard page carries; no article or search text. */
export function toHelpGuideListing(guide: HelpGuide): HelpGuideListing {
  return {
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    contextSummary: guide.contextSummary,
    category: guide.category,
    tags: guide.tags,
    routes: guide.routes,
    readingMinutes: guide.readingMinutes,
    sections: guide.sections.map((section) => ({
      id: section.id,
      topicId: section.topicId,
      title: section.title,
      summary: section.summary,
    })),
  }
}

/** The full shape used to read and search guides. */
export function toHelpGuidePreview(guide: HelpGuide): HelpGuidePreview {
  return {
    ...toHelpGuideListing(guide),
    content: guide.content,
    searchText: guide.searchText,
    sections: guide.sections.map((section) => ({
      id: section.id,
      topicId: section.topicId,
      title: section.title,
      summary: section.summary,
      searchText: normalizeSearchText(
        `${section.title} ${section.summary} ${section.content}`,
      ),
    })),
  }
}

export function searchAllowedHelpGuides(
  guides: readonly HelpGuidePreview[],
  query: string,
  limit = 20,
): readonly HelpGuidePreviewResult[] {
  const normalizedTokens = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  const meaningfulTokens = normalizedTokens.filter(
    (token) => !HELP_SEARCH_STOP_WORDS.has(token),
  )
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : normalizedTokens
  if (tokens.length === 0) return []

  const results: HelpGuidePreviewResult[] = []
  for (const guide of guides) {
    const title = normalizeSearchText(guide.title)
    const summary = normalizeSearchText(guide.summary)
    const tags = normalizeSearchText(guide.tags.join(" "))
    const haystack = normalizeSearchText(guide.searchText)
    if (!tokens.every((token) => haystack.includes(token))) continue

    let score = 0
    for (const token of tokens) {
      if (title.includes(token)) score += 8
      if (tags.includes(token)) score += 5
      if (summary.includes(token)) score += 3
      score += 1
    }
    const matchedSections = guide.sections.filter((section) =>
      tokens.every((token) => section.searchText.includes(token)),
    )

    results.push({
      guide,
      href:
        matchedSections.length === 1
          ? `/dashboard/help/${guide.slug}#${matchedSections[0].id}`
          : `/dashboard/help/${guide.slug}`,
      score,
    })
  }

  return results
    .sort(
      (left, right) =>
        right.score - left.score || left.guide.title.localeCompare(right.guide.title),
    )
    .slice(0, limit)
}

function routePatternMatches(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return false

  return patternParts.every((part, index) => {
    if (part.startsWith("[") && part.endsWith("]")) return true
    return part === pathParts[index]
  })
}

export function helpGuidesForPathname<Guide extends HelpGuideListing>(
  guides: readonly Guide[],
  pathname: string,
): readonly Guide[] {
  const cleanPathname = pathname.split(/[?#]/, 1)[0]
  return guides.filter((guide) =>
    guide.routes.some((route) => routePatternMatches(route, cleanPathname)),
  )
}

export function helpHrefWithReturnTo(href: string, returnTo: string): string {
  if (!href.startsWith("/dashboard/help")) return href
  const hashIndex = href.indexOf("#")
  const baseHref = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex)
  const separator = baseHref.includes("?") ? "&" : "?"
  return `${baseHref}${separator}returnTo=${encodeURIComponent(returnTo)}${hash}`
}

export function helpReturnToForLocation(
  pathname: string,
  searchParams: string,
): string {
  if (pathname.startsWith("/dashboard/help")) {
    const existingReturnTo = new URLSearchParams(searchParams).get("returnTo")
    const safeExistingReturnTo = safeHelpReturnTo(existingReturnTo ?? undefined)
    if (safeExistingReturnTo) return safeExistingReturnTo
  }
  return searchParams.length > 0 ? `${pathname}?${searchParams}` : pathname
}

export function safeHelpReturnTo(value: string | undefined): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null
  if (value.startsWith("/dashboard/help")) return null
  return value
}

export function buildHelpTopicPrompt(input: {
  readonly topicId: string
  readonly title: string
}): string {
  return [
    `Using the official Compass Help topic \`${input.topicId}\`, answer my question about “${input.title}.”`,
    "Lead with the useful next step, then give only the details I need.",
    "Write naturally and concisely; do not restate my request, announce what page I am looking at, or use canned headings such as “Official workflow guidance” and “Page-specific advice.”",
    "If live page context does not identify a specific record, omit record-specific claims instead of adding a disclaimer about missing context.",
    "End with one relevant full-guide link.",
  ].join(" ")
}
