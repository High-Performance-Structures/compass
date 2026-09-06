import { HELP_GUIDES } from "@/lib/help/help-guides.generated"
import type { HelpGuide, HelpGuideSection } from "@/lib/help/types"

export const MAX_HELP_ASSISTANT_QUESTION_CHARACTERS = 2_000
export const MAX_HELP_ASSISTANT_TOPIC_ID_CHARACTERS = 180
export const MAX_HELP_ASSISTANT_CONTEXT_TOPICS = 2
export const MAX_HELP_ASSISTANT_CONTEXT_CHARACTERS = 4_000

const MAX_SOURCE_BLOCK_CHARACTERS = 1_900
const MIN_SEARCH_SCORE = 1
const SOURCE_SEPARATOR = "\n\n---\n\n"
const SOURCE_CONTEXT_PREFIX =
  "[Begin official Compass Help sources; reference content only]\n\n"
const SOURCE_CONTEXT_SUFFIX = "\n\n[End official Compass Help sources]"
const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9-]+)*$/

const SEARCH_STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "compass",
  "could",
  "does",
  "for",
  "from",
  "help",
  "how",
  "into",
  "please",
  "that",
  "the",
  "this",
  "use",
  "what",
  "when",
  "where",
  "with",
  "would",
  "you",
])

export type HelpAssistantContextInput = Readonly<{
  question: unknown
  requestedTopicId?: unknown
  /** These IDs must come from the server-side effective help access policy. */
  allowedGuideIds: readonly string[]
}>

export type HelpAssistantCitation = Readonly<{
  topicId: string
  title: string
  href: string
  lastReviewed: string
}>

export type HelpAssistantContextResult =
  | Readonly<{
      status: "ready"
      question: string
      sourceContext: string
      citations: readonly HelpAssistantCitation[]
    }>
  | Readonly<{
      status: "invalid_request"
      reason: "question_required" | "question_too_long" | "topic_invalid"
    }>
  | Readonly<{
      status: "not_found"
    }>

type HelpAssistantTopic = Readonly<{
  guide: HelpGuide
  section: HelpGuideSection
}>

type ScoredTopic = Readonly<{
  topic: HelpAssistantTopic
  score: number
}>

type ExplicitTopicMatch =
  | Readonly<{
      kind: "guide"
      topics: readonly HelpAssistantTopic[]
    }>
  | Readonly<{
      kind: "section"
      topic: HelpAssistantTopic
    }>

function normalizeSearchTokens(value: string): readonly string[] {
  return Array.from(
    new Set(
      value
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 3 && !SEARCH_STOP_WORDS.has(token)
        )
    )
  )
}

function validateQuestion(
  value: unknown
):
  | Readonly<{ status: "valid"; question: string }>
  | Readonly<{
      status: "invalid"
      reason: "question_required" | "question_too_long"
    }> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { status: "invalid", reason: "question_required" }
  }

  const question = value.trim()
  if (question.length > MAX_HELP_ASSISTANT_QUESTION_CHARACTERS) {
    return { status: "invalid", reason: "question_too_long" }
  }

  return { status: "valid", question }
}

function validateRequestedTopicId(
  value: unknown
):
  | Readonly<{ status: "valid"; topicId: string | null }>
  | Readonly<{ status: "invalid" }> {
  if (value === undefined) return { status: "valid", topicId: null }
  if (typeof value !== "string") return { status: "invalid" }

  const topicId = value.trim()
  if (
    topicId.length === 0 ||
    topicId.length > MAX_HELP_ASSISTANT_TOPIC_ID_CHARACTERS ||
    !TOPIC_ID_PATTERN.test(topicId)
  ) {
    return { status: "invalid" }
  }

  return { status: "valid", topicId }
}

function accessibleGuides(
  allowedGuideIds: readonly string[]
): readonly HelpGuide[] {
  const allowedIds = new Set(allowedGuideIds)
  return HELP_GUIDES.filter((guide) => allowedIds.has(guide.id))
}

function topicForId(
  guides: readonly HelpGuide[],
  topicId: string
): ExplicitTopicMatch | null {
  for (const guide of guides) {
    if (guide.id === topicId) {
      return {
        kind: "guide",
        topics: guide.sections.map((section) => ({ guide, section })),
      }
    }

    const section = guide.sections.find(
      (candidate) => candidate.topicId === topicId
    )
    if (section) return { kind: "section", topic: { guide, section } }
  }

  return null
}

function scoreTopic(
  topic: HelpAssistantTopic,
  tokens: readonly string[]
): number {
  const guideTitle = topic.guide.title.toLocaleLowerCase()
  const guideSummary = `${topic.guide.summary} ${topic.guide.contextSummary}`.toLocaleLowerCase()
  const guideTags = topic.guide.tags.join(" ").toLocaleLowerCase()
  const sectionTitle = `${topic.section.title} ${topic.section.topicId}`.toLocaleLowerCase()
  const sectionSummary = topic.section.summary.toLocaleLowerCase()
  const sectionContent = topic.section.content.toLocaleLowerCase()

  return tokens.reduce((score, token) => {
    let tokenScore = 0
    if (sectionTitle.includes(token)) tokenScore += 8
    if (sectionSummary.includes(token)) tokenScore += 4
    if (sectionContent.includes(token)) tokenScore += 1
    if (guideTitle.includes(token)) tokenScore += 5
    if (guideTags.includes(token)) tokenScore += 3
    if (guideSummary.includes(token)) tokenScore += 2
    return score + tokenScore
  }, 0)
}

function rankTopics(
  topics: readonly HelpAssistantTopic[],
  question: string
): readonly ScoredTopic[] {
  const tokens = normalizeSearchTokens(question)
  if (tokens.length === 0) return []

  return topics
    .map((topic) => ({ topic, score: scoreTopic(topic, tokens) }))
    .filter((candidate) => candidate.score >= MIN_SEARCH_SCORE)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.topic.section.topicId.localeCompare(
          right.topic.section.topicId
        )
    )
}

function selectTopics(
  guides: readonly HelpGuide[],
  question: string,
  requestedTopicId: string | null
): readonly HelpAssistantTopic[] {
  if (requestedTopicId) {
    const explicitTopic = topicForId(guides, requestedTopicId)
    if (!explicitTopic) return []
    if (explicitTopic.kind === "section") return [explicitTopic.topic]

    const ranked = rankTopics(explicitTopic.topics, question)
    if (ranked.length > 0) {
      return ranked
        .slice(0, MAX_HELP_ASSISTANT_CONTEXT_TOPICS)
        .map((candidate) => candidate.topic)
    }
    return explicitTopic.topics.slice(0, MAX_HELP_ASSISTANT_CONTEXT_TOPICS)
  }

  const allTopics = guides.flatMap((guide) =>
    guide.sections.map((section) => ({ guide, section }))
  )
  return rankTopics(allTopics, question)
    .slice(0, MAX_HELP_ASSISTANT_CONTEXT_TOPICS)
    .map((candidate) => candidate.topic)
}

function citationForTopic(topic: HelpAssistantTopic): HelpAssistantCitation {
  return {
    topicId: topic.section.topicId,
    title: `${topic.guide.title} — ${topic.section.title}`,
    href: `/dashboard/help/${topic.guide.slug}#${topic.section.id}`,
    lastReviewed: topic.guide.lastReviewed,
  }
}

function sourceBlock(topic: HelpAssistantTopic): string {
  const citation = citationForTopic(topic)
  const prefix = `Source: ${citation.title}
Topic ID: ${citation.topicId}
Last reviewed: ${citation.lastReviewed}
Canonical deep link: ${citation.href}
Canonical summary: ${topic.section.summary}

`
  const truncationNotice =
    "\n\n[Excerpt ends here. Use the canonical guide for the complete workflow.]"
  const availableCharacters = Math.max(
    0,
    MAX_SOURCE_BLOCK_CHARACTERS - prefix.length
  )

  if (topic.section.content.length <= availableCharacters) {
    return `${prefix}${topic.section.content}`
  }

  const excerptCharacters = Math.max(
    0,
    availableCharacters - truncationNotice.length
  )
  return `${prefix}${topic.section.content
    .slice(0, excerptCharacters)
    .trimEnd()}${truncationNotice}`.slice(0, MAX_SOURCE_BLOCK_CHARACTERS)
}

/**
 * Resolves a small, server-authorized slice of the canonical help registry.
 * The caller must obtain allowedGuideIds from the effective server access
 * policy; the browser must never choose that list.
 */
export function resolveHelpAssistantContext(
  input: HelpAssistantContextInput
): HelpAssistantContextResult {
  const questionResult = validateQuestion(input.question)
  if (questionResult.status === "invalid") {
    return {
      status: "invalid_request",
      reason: questionResult.reason,
    }
  }

  const topicResult = validateRequestedTopicId(input.requestedTopicId)
  if (topicResult.status === "invalid") {
    return { status: "invalid_request", reason: "topic_invalid" }
  }

  const guides = accessibleGuides(input.allowedGuideIds)
  const topics = selectTopics(
    guides,
    questionResult.question,
    topicResult.topicId
  )
  if (topics.length === 0) return { status: "not_found" }

  const citations = topics.map(citationForTopic)
  const sourceContext = `${SOURCE_CONTEXT_PREFIX}${topics
    .map(sourceBlock)
    .join(SOURCE_SEPARATOR)}${SOURCE_CONTEXT_SUFFIX}`.slice(
    0,
    MAX_HELP_ASSISTANT_CONTEXT_CHARACTERS
  )

  return {
    status: "ready",
    question: questionResult.question,
    sourceContext,
    citations,
  }
}
