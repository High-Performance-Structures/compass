import { HELP_GUIDES } from "@/lib/help"
import type { HelpGuide } from "@/lib/help/types"

export const HELP_REVIEW_MAX_AGE_DAYS = 180

/**
 * High-risk or multi-step product areas that must always have a maintained
 * canonical guide. Adding another consequential workflow should add its route
 * here in the same change.
 */
export const MONITORED_HELP_WORKFLOW_ROUTES: readonly string[] = [
  "/dashboard/projects",
  "/dashboard/projects/[id]/contacts",
  "/dashboard/projects/[id]/daily-logs",
  "/dashboard/projects/[id]/owner-updates",
  "/dashboard/projects/[id]/photos",
  "/dashboard/projects/[id]/schedule",
  "/dashboard/projects/[id]/rfis",
  "/dashboard/projects/[id]/rfqs",
  "/dashboard/projects/[id]/purchase-orders",
  "/dashboard/projects/[id]/selections",
  "/dashboard/projects/[id]/financials",
  "/dashboard/projects/[id]/conversations",
  "/preview/projects/[id]/owner",
  "/preview/projects/[id]/sub-vendor",
]

export type HelpMaintenanceIssue = Readonly<{
  severity: "error" | "warning"
  code:
    | "duplicate-guide-id"
    | "duplicate-guide-slug"
    | "duplicate-topic-id"
    | "missing-sections"
    | "missing-route"
    | "undocumented-workflow"
    | "unknown-context-topic"
    | "invalid-review-date"
    | "future-review-date"
    | "stale-review"
  message: string
  guideId?: string
  route?: string
  topicId?: string
}>

export type HelpMaintenanceInput = Readonly<{
  guides?: readonly HelpGuide[]
  applicationRoutes?: readonly string[]
  contextualTopicIds?: readonly string[]
  monitoredRoutes?: readonly string[]
  now?: Date
  maximumReviewAgeDays?: number
}>

function elapsedDays(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1_000)
}

function parseReviewDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return null
  }
  return parsed
}

function knownTopicIds(guides: readonly HelpGuide[]): ReadonlySet<string> {
  return new Set(
    guides.flatMap((guide) => [
      guide.id,
      ...guide.sections.map((section) => section.topicId),
    ])
  )
}

function routeIsCovered(
  route: string,
  guides: readonly HelpGuide[]
): boolean {
  return guides.some((guide) => guide.routes.includes(route))
}

function duplicateIssues(
  values: readonly Readonly<{
    value: string
    guideId?: string
    topicId?: string
  }>[],
  code:
    | "duplicate-guide-id"
    | "duplicate-guide-slug"
    | "duplicate-topic-id",
  label: string
): readonly HelpMaintenanceIssue[] {
  const seen = new Set<string>()
  const duplicateValues = new Set<string>()
  for (const entry of values) {
    if (seen.has(entry.value)) duplicateValues.add(entry.value)
    seen.add(entry.value)
  }
  return Array.from(duplicateValues).map((value) => ({
    severity: "error",
    code,
    message: `Duplicate ${label} '${value}'.`,
    ...(code === "duplicate-topic-id" ? { topicId: value } : {}),
  }))
}

/**
 * Produces deterministic issues for CI and release checks. The audit combines
 * registry integrity, route drift, contextual-help references, and review age.
 */
export function auditHelpMaintenance(
  input: HelpMaintenanceInput = {}
): readonly HelpMaintenanceIssue[] {
  const guides = input.guides ?? HELP_GUIDES
  const now = input.now ?? new Date()
  const maximumReviewAgeDays =
    input.maximumReviewAgeDays ?? HELP_REVIEW_MAX_AGE_DAYS
  const monitoredRoutes =
    input.monitoredRoutes ?? MONITORED_HELP_WORKFLOW_ROUTES
  const issues: HelpMaintenanceIssue[] = []

  issues.push(
    ...duplicateIssues(
      guides.map((guide) => ({ value: guide.id, guideId: guide.id })),
      "duplicate-guide-id",
      "guide ID"
    ),
    ...duplicateIssues(
      guides.map((guide) => ({ value: guide.slug, guideId: guide.id })),
      "duplicate-guide-slug",
      "guide slug"
    ),
    ...duplicateIssues(
      guides.flatMap((guide) =>
        guide.sections.map((section) => ({
          value: section.topicId,
          guideId: guide.id,
          topicId: section.topicId,
        }))
      ),
      "duplicate-topic-id",
      "topic ID"
    )
  )

  for (const guide of guides) {
    if (guide.sections.length === 0) {
      issues.push({
        severity: "error",
        code: "missing-sections",
        guideId: guide.id,
        message: `Guide '${guide.id}' has no anchored sections.`,
      })
    }

    const reviewedAt = parseReviewDate(guide.lastReviewed)
    if (!reviewedAt) {
      issues.push({
        severity: "error",
        code: "invalid-review-date",
        guideId: guide.id,
        message: `Guide '${guide.id}' has invalid lastReviewed metadata.`,
      })
    } else if (reviewedAt.getTime() > now.getTime()) {
      issues.push({
        severity: "error",
        code: "future-review-date",
        guideId: guide.id,
        message: `Guide '${guide.id}' has a future lastReviewed date.`,
      })
    } else if (elapsedDays(reviewedAt, now) > maximumReviewAgeDays) {
      issues.push({
        severity: "warning",
        code: "stale-review",
        guideId: guide.id,
        message: `Guide '${guide.id}' has not been reviewed in ${maximumReviewAgeDays} days.`,
      })
    }

    if (input.applicationRoutes) {
      for (const route of guide.routes) {
        if (!input.applicationRoutes.includes(route)) {
          issues.push({
            severity: "error",
            code: "missing-route",
            guideId: guide.id,
            route,
            message: `Guide '${guide.id}' references missing route '${route}'.`,
          })
        }
      }
    }
  }

  if (input.applicationRoutes) {
    for (const route of monitoredRoutes) {
      if (!input.applicationRoutes.includes(route)) {
        issues.push({
          severity: "error",
          code: "missing-route",
          route,
          message: `Monitored help workflow route '${route}' no longer exists. Update its guide and maintenance inventory with the UX change.`,
        })
      } else if (!routeIsCovered(route, guides)) {
        issues.push({
          severity: "error",
          code: "undocumented-workflow",
          route,
          message: `Monitored workflow '${route}' has no canonical help guide.`,
        })
      }
    }
  }

  const topics = knownTopicIds(guides)
  for (const topicId of input.contextualTopicIds ?? []) {
    if (!topics.has(topicId)) {
      issues.push({
        severity: "error",
        code: "unknown-context-topic",
        topicId,
        message: `Contextual help references unknown topic '${topicId}'.`,
      })
    }
  }

  return issues
}
