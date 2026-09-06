import type { Action, Resource } from "@/lib/permissions"
import type { UserRole } from "@/lib/user-roles"

export const HELP_AUDIENCES = [
  "staff",
  "owner",
  "subcontractor",
  "supplier",
  "guest",
] as const

export type HelpAudience = (typeof HELP_AUDIENCES)[number]
export type HelpPermission = `${Resource}:${Action}`

export type HelpAccessContext = Readonly<{
  role: UserRole
  permissions: readonly HelpPermission[]
}>

export type HelpGuideSection = Readonly<{
  id: string
  topicId: string
  title: string
  summary: string
  content: string
}>

export type HelpGuide = Readonly<{
  id: string
  featureId: string
  slug: string
  title: string
  summary: string
  contextSummary: string
  category: string
  tags: readonly string[]
  audiences: readonly HelpAudience[]
  permissions: readonly HelpPermission[]
  routes: readonly string[]
  owner: string
  lastReviewed: string
  sourcePath: string
  content: string
  searchText: string
  sections: readonly HelpGuideSection[]
  readingMinutes: number
}>

export type HelpTopic = Readonly<{
  guide: HelpGuide
  section: HelpGuideSection | null
  href: string
}>

export type HelpSearchOptions = Readonly<{
  audience?: HelpAudience
  limit?: number
}>

export type HelpSearchResult = Readonly<{
  guide: HelpGuide
  href: string
  score: number
  matchedSectionIds: readonly string[]
}>
