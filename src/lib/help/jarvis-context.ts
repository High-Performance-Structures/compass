import {
  HELP_GUIDES,
  getHelpGuidesForRoute,
  getHelpTopic,
} from "@/lib/help"
import type {
  HelpGuide,
  HelpGuideSection,
  HelpTopic,
} from "@/lib/help/types"

const MAX_CONTEXT_TOPICS = 2
export const MAX_JARVIS_HELP_CONTEXT_CHARACTERS = 6_000
export const MAX_JARVIS_RELAY_HELP_CONTEXT_CHARACTERS = 3_600
const MAX_EXCERPT_CHARACTERS = 1_800
const MIN_SEARCH_SCORE = 2

const SEARCH_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
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
  "jarvis",
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

export type JarvisHelpMessage = Readonly<{
  role: "user" | "assistant"
  content: string
}>

export type JarvisHelpContextInput = Readonly<{
  currentPage: string
  messages: readonly JarvisHelpMessage[]
  requestedTopicId?: string
  allowedGuideIds: readonly string[]
}>

export type JarvisHelpReference = Readonly<{
  topicId: string
  title: string
  href: string
  lastReviewed: string
}>

export type JarvisHelpContext = Readonly<{
  prompt: string
  references: readonly JarvisHelpReference[]
}>

function latestUserMessage(
  messages: readonly JarvisHelpMessage[]
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user") return message.content
  }
  return ""
}

function normalizeSearchTokens(value: string): readonly string[] {
  return Array.from(
    new Set(
      value
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9.]+/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 3 && !SEARCH_STOP_WORDS.has(token)
        )
    )
  )
}

function explicitTopicIds(
  message: string,
  requestedTopicId: string | undefined
): readonly string[] {
  if (requestedTopicId?.trim()) return [requestedTopicId.trim()]

  const normalizedMessage = message.toLocaleLowerCase()
  const ids = HELP_GUIDES.flatMap((guide) => [
    ...guide.sections.map((section) => section.topicId),
    guide.id,
  ]).sort((left, right) => right.length - left.length)

  const matches = ids.filter((id) =>
    normalizedMessage.includes(id.toLocaleLowerCase())
  )
  return matches.filter(
    (id) =>
      !matches.some(
        (candidate) =>
          candidate !== id && candidate.startsWith(`${id}.`)
      )
  )
}

function topicForGuideSearch(
  guide: HelpGuide,
  tokens: readonly string[]
): Readonly<{ topic: HelpTopic; score: number }> {
  const guideText = `${guide.title} ${guide.summary} ${guide.contextSummary} ${guide.tags.join(" ")}`.toLocaleLowerCase()
  let guideScore = tokens.reduce(
    (score, token) => score + (guideText.includes(token) ? 1 : 0),
    0
  )
  let bestSection: HelpGuideSection | null = null
  let bestSectionScore = 0

  for (const section of guide.sections) {
    const sectionText = `${section.title} ${section.summary}`.toLocaleLowerCase()
    const sectionScore = tokens.reduce(
      (score, token) => score + (sectionText.includes(token) ? 2 : 0),
      0
    )
    if (sectionScore > bestSectionScore) {
      bestSection = section
      bestSectionScore = sectionScore
    }
  }

  guideScore += bestSectionScore
  return {
    topic: {
      guide,
      section: bestSection,
      href: bestSection
        ? `/dashboard/help/${guide.slug}#${bestSection.id}`
        : `/dashboard/help/${guide.slug}`,
    },
    score: guideScore,
  }
}

function selectTopics(
  input: JarvisHelpContextInput,
  guides: readonly HelpGuide[]
): readonly HelpTopic[] {
  const message = latestUserMessage(input.messages)
  const accessibleIds = new Set(guides.map((guide) => guide.id))
  const requestedIds = explicitTopicIds(message, input.requestedTopicId)
  const explicit = requestedIds
    .map((topicId) => getHelpTopic(topicId))
    .filter((topic): topic is HelpTopic =>
      topic !== null && accessibleIds.has(topic.guide.id)
    )

  if (explicit.length > 0) return explicit.slice(0, MAX_CONTEXT_TOPICS)
  // An explicit but inaccessible topic must fail closed. Falling back to a
  // route or keyword match could expose a different guide and make Jarvis's
  // answer appear to satisfy a request it was not allowed to ground.
  if (requestedIds.length > 0) return []

  const tokens = normalizeSearchTokens(message)
  const scored = guides
    .map((guide) => topicForGuideSearch(guide, tokens))
    .filter((candidate) => candidate.score >= MIN_SEARCH_SCORE)
    .sort((left, right) => right.score - left.score)

  if (scored.length > 0) {
    return scored.slice(0, MAX_CONTEXT_TOPICS).map((candidate) => candidate.topic)
  }

  const routeGuideIds = new Set(
    getHelpGuidesForRoute(input.currentPage).map((guide) => guide.id)
  )
  return guides
    .filter((guide) => routeGuideIds.has(guide.id))
    .slice(0, MAX_CONTEXT_TOPICS)
    .map((guide) => ({
      guide,
      section: null,
      href: `/dashboard/help/${guide.slug}`,
    }))
}

function boundedExcerpt(topic: HelpTopic): string {
  const source = topic.section?.content ?? topic.guide.content
  if (source.length <= MAX_EXCERPT_CHARACTERS) return source
  return `${source.slice(0, MAX_EXCERPT_CHARACTERS).trimEnd()}\n\n[Excerpt ends here. Use the linked guide for the complete workflow.]`
}

function topicBlock(topic: HelpTopic): string {
  const title = topic.section
    ? `${topic.guide.title} — ${topic.section.title}`
    : topic.guide.title
  const topicId = topic.section?.topicId ?? topic.guide.id
  return `Source: ${title}
Topic ID: ${topicId}
Last reviewed: ${topic.guide.lastReviewed}
Full guide: ${topic.href}
Canonical summary: ${topic.section?.summary ?? topic.guide.contextSummary}

${boundedExcerpt(topic)}`
}

/**
 * Selects a small, permission-filtered slice of the canonical help registry.
 * This keeps ordinary Jarvis requests from carrying the full guide corpus.
 */
export function resolveJarvisHelpContext(
  input: JarvisHelpContextInput
): JarvisHelpContext | null {
  const allowedGuideIds = new Set(input.allowedGuideIds)
  const guides = HELP_GUIDES.filter((guide) => allowedGuideIds.has(guide.id))
  const topics = selectTopics(input, guides)
  if (topics.length === 0) return null

  const references = topics.map((topic) => ({
    topicId: topic.section?.topicId ?? topic.guide.id,
    title: topic.section
      ? `${topic.guide.title} — ${topic.section.title}`
      : topic.guide.title,
    href: topic.href,
    lastReviewed: topic.guide.lastReviewed,
  }))
  const sourceBlocks = topics.map(topicBlock).join("\n\n---\n\n")
  const prompt = `

Official Compass Help context (trusted, version-controlled application content):
- For questions about what Compass does or how a workflow works, treat the sources below as canonical.
- Do not contradict these sources. Distinguish live project data or your own inference from the official instructions.
- If the requested detail is not covered, say that plainly instead of inventing a workflow.
- Link the relevant full guide in your answer using the supplied Compass path.
- Never expose a guide that the current user cannot access.

${sourceBlocks}`.slice(0, MAX_JARVIS_HELP_CONTEXT_CHARACTERS)

  return { prompt, references }
}

/**
 * Adds trusted application context as assistant history immediately before the
 * latest user request. It is never represented as text authored by the user.
 */
export function addHelpContextToRelayMessages(
  messages: readonly JarvisHelpMessage[],
  context: JarvisHelpContext | null
): readonly JarvisHelpMessage[] {
  if (!context) return messages
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index
      break
    }
  }

  const trustedContextMessage: JarvisHelpMessage = {
    role: "assistant",
    content: `[Trusted Compass application context; this is not a prior answer]\n${context.prompt.slice(0, MAX_JARVIS_RELAY_HELP_CONTEXT_CHARACTERS)}\n[End trusted Compass application context]`,
  }
  if (latestUserIndex < 0) return [...messages, trustedContextMessage]
  return [
    ...messages.slice(0, latestUserIndex),
    trustedContextMessage,
    ...messages.slice(latestUserIndex),
  ]
}
