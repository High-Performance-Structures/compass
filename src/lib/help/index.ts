import { HELP_GUIDES } from "@/lib/help/help-guides.generated"
import type {
  HelpAccessContext,
  HelpAudience,
  HelpGuide,
  HelpSearchOptions,
  HelpSearchResult,
  HelpTopic,
} from "@/lib/help/types"
import type { UserRole } from "@/lib/user-roles"

export { HELP_GUIDES }
export type {
  HelpAudience,
  HelpAccessContext,
  HelpGuide,
  HelpGuideSection,
  HelpPermission,
  HelpSearchOptions,
  HelpSearchResult,
  HelpTopic,
} from "@/lib/help/types"

export { HELP_AUDIENCES } from "@/lib/help/types"

export const HELP_GUIDE_CATEGORIES = [
  "Start Here",
  "Field & Project Work",
  "Client Communication",
  "Project Operations",
  "Communication",
  "Financial Workflows",
  "Support",
] as const

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

function routePatternMatches(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return false

  return patternParts.every((part, index) => {
    if (part.startsWith("[") && part.endsWith("]")) return true
    return part === pathParts[index]
  })
}

export function helpAudienceForRole(role: UserRole): HelpAudience | null {
  if (role === "client") return "owner"
  if (role === "subcontractor") return "subcontractor"
  if (role === "supplier") return "supplier"
  if (role === "guest") return "guest"
  return "staff"
}

export function canAccessHelpGuide(
  guide: HelpGuide,
  context: HelpAccessContext
): boolean {
  const audience = helpAudienceForRole(context.role)
  if (!audience || !guide.audiences.includes(audience)) return false
  return guide.permissions.every((permission) =>
    context.permissions.includes(permission)
  )
}

export function getHelpGuides(): readonly HelpGuide[] {
  return HELP_GUIDES
}

export function getHelpGuide(slug: string): HelpGuide | null {
  return HELP_GUIDES.find((guide) => guide.slug === slug) ?? null
}

export function getHelpTopic(topicId: string): HelpTopic | null {
  const guide = HELP_GUIDES.find((candidate) => candidate.id === topicId)
  if (guide) {
    return { guide, section: null, href: `/dashboard/help/${guide.slug}` }
  }

  for (const candidate of HELP_GUIDES) {
    const section = candidate.sections.find(
      (candidateSection) => candidateSection.topicId === topicId
    )
    if (section) {
      return {
        guide: candidate,
        section,
        href: `/dashboard/help/${candidate.slug}#${section.id}`,
      }
    }
  }

  return null
}

export function getHelpGuidesForRoute(pathname: string): readonly HelpGuide[] {
  const cleanPathname = pathname.split(/[?#]/, 1)[0]
  return HELP_GUIDES.filter((guide) =>
    guide.routes.some((route) => routePatternMatches(route, cleanPathname))
  )
}

export function searchHelpGuides(
  query: string,
  options: HelpSearchOptions = {}
): readonly HelpSearchResult[] {
  const normalizedTokens = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  const meaningfulTokens = normalizedTokens.filter(
    (token) => !HELP_SEARCH_STOP_WORDS.has(token)
  )
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : normalizedTokens
  if (tokens.length === 0) return []

  const results: HelpSearchResult[] = []
  for (const guide of HELP_GUIDES) {
    if (options.audience && !guide.audiences.includes(options.audience)) continue

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
      if (haystack.includes(token)) score += 1
    }
    const matchedSections = guide.sections.filter((section) => {
      const sectionText = normalizeSearchText(
        `${section.title} ${section.summary} ${section.content}`
      )
      return tokens.every((token) => sectionText.includes(token))
    })

    results.push({
      guide,
      href:
        matchedSections.length === 1
          ? `/dashboard/help/${guide.slug}#${matchedSections[0].id}`
          : `/dashboard/help/${guide.slug}`,
      score,
      matchedSectionIds: matchedSections.map((section) => section.id),
    })
  }

  results.sort(
    (left, right) =>
      right.score - left.score || left.guide.title.localeCompare(right.guide.title)
  )
  return results.slice(0, options.limit ?? 20)
}

// Compatibility aliases for the first help-library implementation.
export const STAFF_GUIDES = HELP_GUIDES
export const STAFF_GUIDE_CATEGORIES = HELP_GUIDE_CATEGORIES
export const getStaffGuides = getHelpGuides
export const getStaffGuide = getHelpGuide
